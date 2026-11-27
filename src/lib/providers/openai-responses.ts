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

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  return `${trimmed}/responses`;
}

function extractResponsesText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = data.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: string }).type === "message" &&
        Array.isArray((item as { content?: unknown[] }).content)
      ) {
        for (const part of (item as { content: Array<{ text?: string }> })
          .content) {
          if (typeof part?.text === "string" && part.text.trim()) {
            return part.text.trim();
          }
        }
      }
    }
  }
  return "OK";
}

export const openaiResponsesProvider: ModelProvider = {
  id: "openai-responses",

  async testConnection(config: ModelConfig): Promise<ProviderTestResult> {
    const endpoint = buildResponsesUrl(config.baseUrl);
    const start = Date.now();
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model.trim(),
          input: "Reply with OK only.",
          max_output_tokens: 64,
          store: false,
        }),
        signal: AbortSignal.timeout(25000),
      });

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

      const data = (await upstream.json()) as Record<string, unknown>;
      return {
        ok: true,
        latencyMs,
        model: String(data.model || config.model),
        reply: extractResponsesText(data).slice(0, 80),
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
    const endpoint = buildResponsesUrl(init.config.baseUrl);
    const instructions = `${init.systemPrompt}\n\n${init.workspaceContext}`;
    const tools = init.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let previousResponseId: string | undefined;
    let nextInput: Array<Record<string, unknown>> = [
      ...init.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: init.userPrompt },
    ];

    return {
      async runTurn({ signal, onTextDelta }): Promise<ProviderTurnResult> {
        const payload: Record<string, unknown> = {
          model: init.config.model.trim(),
          instructions,
          input: nextInput,
          tools,
          tool_choice: "auto",
          stream: true,
        };
        if (previousResponseId) {
          payload.previous_response_id = previousResponseId;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${init.config.apiKey.trim()}`,
          },
          body: JSON.stringify(payload),
          signal,
        });

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
        const toolCallsByItemId = new Map<string, ProviderToolCall>();
        const toolCallOrder: string[] = [];
        let completedOutputItems: Array<Record<string, unknown>> | null = null;
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
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(dataStr) as Record<string, unknown>;
            } catch {
              continue;
            }

            const evtType = String(evt.type || "");

            if (
              evtType === "response.created" ||
              evtType === "response.in_progress"
            ) {
              const resp = evt.response as { id?: string } | undefined;
              if (resp?.id) previousResponseId = resp.id;
            } else if (evtType === "response.output_text.delta") {
              const delta = typeof evt.delta === "string" ? evt.delta : "";
              if (delta) {
                content += delta;
                onTextDelta(delta);
              }
            } else if (evtType === "response.reasoning_summary_text.delta") {
              const delta = typeof evt.delta === "string" ? evt.delta : "";
              if (delta) {
                reasoning += delta;
                onTextDelta(delta);
              }
            } else if (evtType === "response.output_item.added") {
              const item = evt.item as
                | {
                    id?: string;
                    type?: string;
                    call_id?: string;
                    name?: string;
                    arguments?: string;
                  }
                | undefined;
              if (item?.type === "function_call") {
                const key =
                  item.id || item.call_id || `fc_${toolCallOrder.length}`;
                if (!toolCallsByItemId.has(key)) {
                  toolCallOrder.push(key);
                  toolCallsByItemId.set(key, {
                    id: item.call_id || key,
                    name: item.name || "",
                    argumentsStr: item.arguments || "",
                  });
                }
              }
            } else if (evtType === "response.function_call_arguments.delta") {
              const key = String(evt.item_id || "");
              const delta = typeof evt.delta === "string" ? evt.delta : "";
              if (key && delta) {
                const existing = toolCallsByItemId.get(key);
                if (existing) existing.argumentsStr += delta;
              }
            } else if (evtType === "response.output_item.done") {
              const item = evt.item as
                | {
                    id?: string;
                    type?: string;
                    call_id?: string;
                    name?: string;
                    arguments?: string;
                  }
                | undefined;
              if (item?.type === "function_call") {
                const key =
                  item.id || item.call_id || `fc_${toolCallOrder.length}`;
                if (!toolCallsByItemId.has(key)) {
                  toolCallOrder.push(key);
                }
                toolCallsByItemId.set(key, {
                  id: item.call_id || key,
                  name: item.name || "",
                  argumentsStr: item.arguments || "",
                });
              }
            } else if (evtType === "response.completed") {
              const resp = evt.response as
                | {
                    id?: string;
                    output?: Array<Record<string, unknown>>;
                    usage?: {
                      input_tokens?: number;
                      input_tokens_details?: {
                        cached_tokens?: number;
                      };
                      output_tokens?: number;
                      total_tokens?: number;
                    };
                  }
                | undefined;
              if (resp?.id) previousResponseId = resp.id;
              if (Array.isArray(resp?.output)) {
                completedOutputItems = resp.output;
              }
              if (resp?.usage) {
                const rawInput = Math.max(0, Number(resp.usage.input_tokens) || 0);
                const cachedInputTokens = Math.min(
                  rawInput,
                  Math.max(
                    0,
                    Number(resp.usage.input_tokens_details?.cached_tokens) || 0
                  )
                );
                const inputTokens = Math.max(0, rawInput - cachedInputTokens);
                const outputTokens = Math.max(
                  0,
                  Number(resp.usage.output_tokens) || 0
                );
                const totalTokens = Math.max(
                  rawInput + outputTokens,
                  Number(resp.usage.total_tokens) || 0
                );
                usage = {
                  inputTokens,
                  cachedInputTokens,
                  cacheWriteTokens: 0,
                  outputTokens,
                  totalTokens,
                };
              }
            } else if (evtType === "response.failed" || evtType === "error") {
              const errObj = (evt.error ||
                (evt.response as { error?: { message?: string } } | undefined)
                  ?.error) as { message?: string } | undefined;
              throw new Error(errObj?.message || "模型流式响应失败。");
            }
          }
        }

        let toolCalls: ProviderToolCall[] = toolCallOrder
          .map((k) => toolCallsByItemId.get(k)!)
          .filter((tc) => tc && tc.name.trim().length > 0);

        if (completedOutputItems) {
          const fromCompleted: ProviderToolCall[] = [];
          for (const item of completedOutputItems) {
            if (item.type === "function_call" && typeof item.name === "string") {
              fromCompleted.push({
                id: String(
                  item.call_id || item.id || `call_${fromCompleted.length}`
                ),
                name: item.name,
                argumentsStr:
                  typeof item.arguments === "string" ? item.arguments : "{}",
              });
            }
          }
          if (fromCompleted.length > 0) {
            toolCalls = fromCompleted;
          }
        }

        return { content, reasoning, toolCalls, usage };
      },

      appendToolResults(results: ProviderToolResultInput[]) {
        nextInput = results.map((r) => ({
          type: "function_call_output",
          call_id: r.callId,
          output: r.output,
        }));
      },

      appendUserFollowUp(content: string) {
        nextInput = [{ role: "user", content }];
      },
    };
  },
};
