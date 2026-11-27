import type { ModelConfig } from "../types";
import {
  parseJsonErrorMessage,
  type ModelProvider,
  type ProviderSession,
  type ProviderSessionInit,
  type ProviderTestResult,
  type ProviderTokenUsage,
  type ProviderToolCall,
  type ProviderToolResultInput,
  type ProviderTurnResult,
} from "./types";

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export const openaiCompatibleProvider: ModelProvider = {
  id: "openai-compatible",

  async testConnection(config: ModelConfig): Promise<ProviderTestResult> {
    const endpoint = buildChatCompletionsUrl(config.baseUrl);
    const start = Date.now();
    const baseMessages = [{ role: "user", content: "Reply with OK only." }];

    const doRequest = (payload: Record<string, unknown>) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });

    try {
      let upstream = await doRequest({
        model: config.model.trim(),
        messages: baseMessages,
        max_completion_tokens: 64,
      });

      if (!upstream.ok && upstream.status === 400) {
        const detail = await parseJsonErrorMessage(upstream);
        if (detail.includes("max_completion_tokens")) {
          upstream = await doRequest({
            model: config.model.trim(),
            messages: baseMessages,
            max_tokens: 64,
          });
        } else {
          return {
            ok: false,
            status: upstream.status,
            latencyMs: Date.now() - start,
            error: `请求失败 (HTTP ${upstream.status}): ${detail.slice(0, 300)}`,
          };
        }
      }

      const latencyMs = Date.now() - start;
      if (!upstream.ok) {
        const detail = await parseJsonErrorMessage(upstream);
        return {
          ok: false,
          status: upstream.status,
          latencyMs,
          error: `请求失败 (HTTP ${upstream.status}): ${detail.slice(0, 300)}`,
        };
      }

      const data = await upstream.json();
      const reply = data?.choices?.[0]?.message?.content ?? "OK";
      return {
        ok: true,
        latencyMs,
        model: data?.model || config.model,
        reply: String(reply).trim().slice(0, 80),
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error:
          err instanceof Error
            ? `连接异常: ${err.message}`
            : "连接测试失败，请检查网络与接口地址。",
      };
    }
  },

  createSession(init: ProviderSessionInit): ProviderSession {
    const endpoint = buildChatCompletionsUrl(init.config.baseUrl);
    const tools = init.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const messages: ChatCompletionMessage[] = [
      { role: "system", content: init.systemPrompt },
      { role: "system", content: init.workspaceContext },
      ...init.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: init.userPrompt },
    ];

    return {
      async runTurn({ signal, onTextDelta }): Promise<ProviderTurnResult> {
        const doStreamFetch = (includeStreamOptions: boolean) =>
          fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${init.config.apiKey.trim()}`,
            },
            body: JSON.stringify({
              model: init.config.model.trim(),
              messages,
              tools,
              tool_choice: "auto",
              stream: true,
              ...(includeStreamOptions
                ? { stream_options: { include_usage: true } }
                : {}),
            }),
            signal,
          });

        let response = await doStreamFetch(true);
        if (!response.ok && response.status === 400) {
          const detail = await parseJsonErrorMessage(response);
          if (detail.toLowerCase().includes("stream_options")) {
            response = await doStreamFetch(false);
          } else {
            throw new Error(
              `模型接口返回错误 (HTTP ${response.status}): ${detail.slice(0, 400)}`
            );
          }
        }

        if (!response.ok) {
          const detail = await parseJsonErrorMessage(response);
          throw new Error(
            `模型接口返回错误 (HTTP ${response.status}): ${detail.slice(0, 400)}`
          );
        }
        if (!response.body) {
          throw new Error("模型接口未返回流式响应体。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let buffer = "";
        let content = "";
        let reasoning = "";
        const toolCallsMap = new Map<number, ProviderToolCall>();
        let usage: ProviderTokenUsage | undefined;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;

            let chunk: {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
              }>;
              usage?: {
                prompt_tokens?: number;
                prompt_tokens_details?: {
                  cached_tokens?: number;
                };
                prompt_cache_hit_tokens?: number;
                prompt_cache_miss_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
              error?: { message?: string };
            };

            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }

            if (chunk.error?.message) {
              throw new Error(`模型流式返回错误: ${chunk.error.message}`);
            }

            if (chunk.usage) {
              const rawPrompt = Math.max(
                0,
                Number(chunk.usage.prompt_tokens) || 0
              );
              const rawCached = Math.max(
                0,
                Number(
                  chunk.usage.prompt_tokens_details?.cached_tokens ??
                    chunk.usage.prompt_cache_hit_tokens
                ) || 0
              );
              const cachedInputTokens = Math.min(rawPrompt, rawCached);
              const inputTokens =
                typeof chunk.usage.prompt_cache_miss_tokens === "number"
                  ? Math.max(0, chunk.usage.prompt_cache_miss_tokens)
                  : Math.max(0, rawPrompt - cachedInputTokens);
              const outputTokens = Math.max(
                0,
                Number(chunk.usage.completion_tokens) || 0
              );
              const totalTokens = Math.max(
                inputTokens + cachedInputTokens + outputTokens,
                Number(chunk.usage.total_tokens) || 0
              );
              usage = {
                inputTokens,
                cachedInputTokens,
                cacheWriteTokens: 0,
                outputTokens,
                totalTokens,
              };
            }

            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (
              typeof delta.reasoning_content === "string" &&
              delta.reasoning_content
            ) {
              reasoning += delta.reasoning_content;
              onTextDelta(delta.reasoning_content);
            }

            if (typeof delta.content === "string" && delta.content) {
              content += delta.content;
              onTextDelta(delta.content);
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === "number" ? tc.index : 0;
                const existing = toolCallsMap.get(idx) ?? {
                  id: tc.id || `call_${idx}_${Date.now()}`,
                  name: "",
                  argumentsStr: "",
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) {
                  existing.argumentsStr += tc.function.arguments;
                }
                toolCallsMap.set(idx, existing);
              }
            }
          }
        }

        const toolCalls = Array.from(toolCallsMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v)
          .filter((tc) => tc.name.trim().length > 0);

        const assistantMsg: ChatCompletionMessage = {
          role: "assistant",
          content: content || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: tc.argumentsStr || "{}",
                  },
                })),
              }
            : {}),
        };
        messages.push(assistantMsg);

        return { content, reasoning, toolCalls, usage };
      },

      appendToolResults(results: ProviderToolResultInput[]) {
        for (const r of results) {
          messages.push({
            role: "tool",
            tool_call_id: r.callId,
            content: r.output,
          });
        }
      },

      appendUserFollowUp(content: string) {
        messages.push({ role: "user", content });
      },
    };
  },
};
