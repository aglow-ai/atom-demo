import type { ModelConfig } from "../types";
import {
  parseJsonErrorMessage,
  type ModelProvider,
  type ProviderSession,
  type ProviderSessionInit,
  type ProviderTestResult,
  type ProviderToolCall,
  type ProviderToolResultInput,
  type ProviderTurnResult,
} from "./types";

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: "text" | "thinking" | "redacted_thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  signature?: string;
  data?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function buildMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  return `${trimmed}/messages`;
}

export const anthropicNativeProvider: ModelProvider = {
  id: "anthropic-native",

  async testConnection(config: ModelConfig): Promise<ProviderTestResult> {
    const endpoint = buildMessagesUrl(config.baseUrl);
    const start = Date.now();
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey.trim(),
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: config.model.trim(),
          max_tokens: 64,
          messages: [{ role: "user", content: "Reply with OK only." }],
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

      const data = (await upstream.json()) as {
        model?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      const textBlock = (data.content || []).find((b) => b.type === "text");
      return {
        ok: true,
        latencyMs,
        model: data.model || config.model,
        reply: (textBlock?.text || "OK").trim().slice(0, 80),
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
    const endpoint = buildMessagesUrl(init.config.baseUrl);
    const systemText = `${init.systemPrompt}\n\n${init.workspaceContext}`;
    const tools = init.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    // Anthropic requires strictly alternating user/assistant messages starting with user
    const messages: AnthropicMessage[] = [];
    for (const h of init.history) {
      if (messages.length === 0 && h.role !== "user") continue;
      const last = messages[messages.length - 1];
      if (last && last.role === h.role && typeof last.content === "string") {
        last.content += `\n\n${h.content}`;
      } else {
        messages.push({ role: h.role, content: h.content });
      }
    }
    const lastBeforePrompt = messages[messages.length - 1];
    if (
      lastBeforePrompt &&
      lastBeforePrompt.role === "user" &&
      typeof lastBeforePrompt.content === "string"
    ) {
      lastBeforePrompt.content += `\n\n${init.userPrompt}`;
    } else {
      messages.push({ role: "user", content: init.userPrompt });
    }

    return {
      async runTurn({ signal, onTextDelta }): Promise<ProviderTurnResult> {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": init.config.apiKey.trim(),
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: init.config.model.trim(),
            max_tokens: 16384,
            system: systemText,
            messages,
            tools,
            stream: true,
          }),
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

        interface BlockAccumulator {
          type: AnthropicContentBlock["type"];
          text: string;
          thinking: string;
          signature: string;
          data?: string;
          id?: string;
          name?: string;
          inputJson: string;
        }

        const blocksByIndex = new Map<number, BlockAccumulator>();

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

            if (evtType === "content_block_start") {
              const index = Number(evt.index ?? 0);
              const cb = evt.content_block as
                | {
                    type?: AnthropicContentBlock["type"];
                    text?: string;
                    thinking?: string;
                    signature?: string;
                    data?: string;
                    id?: string;
                    name?: string;
                  }
                | undefined;
              if (cb?.type) {
                blocksByIndex.set(index, {
                  type: cb.type,
                  text: cb.text || "",
                  thinking: cb.thinking || "",
                  signature: cb.signature || "",
                  data: cb.data,
                  id: cb.id,
                  name: cb.name,
                  inputJson: "",
                });
              }
            } else if (evtType === "content_block_delta") {
              const index = Number(evt.index ?? 0);
              const block = blocksByIndex.get(index);
              const delta = evt.delta as
                | {
                    type?: string;
                    text?: string;
                    thinking?: string;
                    signature?: string;
                    partial_json?: string;
                  }
                | undefined;
              if (!block || !delta) continue;

              if (delta.type === "text_delta" && delta.text) {
                block.text += delta.text;
                content += delta.text;
                onTextDelta(delta.text);
              } else if (delta.type === "thinking_delta" && delta.thinking) {
                block.thinking += delta.thinking;
                reasoning += delta.thinking;
                onTextDelta(delta.thinking);
              } else if (delta.type === "signature_delta" && delta.signature) {
                block.signature += delta.signature;
              } else if (
                delta.type === "input_json_delta" &&
                delta.partial_json
              ) {
                block.inputJson += delta.partial_json;
              }
            } else if (evtType === "error") {
              const errObj = evt.error as { message?: string } | undefined;
              throw new Error(errObj?.message || "模型流式响应失败。");
            }
          }
        }

        const assistantBlocks: AnthropicContentBlock[] = [];
        const toolCalls: ProviderToolCall[] = [];

        const ordered = Array.from(blocksByIndex.entries()).sort(
          (a, b) => a[0] - b[0]
        );
        for (const [, b] of ordered) {
          if (b.type === "text" && b.text) {
            assistantBlocks.push({ type: "text", text: b.text });
          } else if (b.type === "thinking") {
            assistantBlocks.push({
              type: "thinking",
              thinking: b.thinking,
              ...(b.signature ? { signature: b.signature } : {}),
            });
          } else if (b.type === "redacted_thinking" && b.data) {
            assistantBlocks.push({ type: "redacted_thinking", data: b.data });
          } else if (b.type === "tool_use" && b.name) {
            const callId = b.id || `toolu_${toolCalls.length}_${Date.now()}`;
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = b.inputJson.trim()
                ? (JSON.parse(b.inputJson) as Record<string, unknown>)
                : {};
            } catch {
              parsedInput = {};
            }
            assistantBlocks.push({
              type: "tool_use",
              id: callId,
              name: b.name,
              input: parsedInput,
            });
            toolCalls.push({
              id: callId,
              name: b.name,
              argumentsStr: b.inputJson.trim() || "{}",
            });
          }
        }

        if (assistantBlocks.length > 0) {
          messages.push({ role: "assistant", content: assistantBlocks });
        }

        return { content, reasoning, toolCalls };
      },

      appendToolResults(results: ProviderToolResultInput[]) {
        messages.push({
          role: "user",
          content: results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.callId,
            content: r.output,
            is_error: !r.ok,
          })),
        });
      },

      appendUserFollowUp(content: string) {
        messages.push({ role: "user", content });
      },
    };
  },
};
