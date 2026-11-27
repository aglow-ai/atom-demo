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

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  [key: string]: unknown;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function normalizeGeminiBaseUrl(baseUrl: string): string {
  let trimmed = baseUrl.trim().replace(/\/+$/, "");
  // Automatically normalize legacy /v1beta/openai URLs saved in localStorage to native /v1beta
  if (trimmed.endsWith("/openai")) {
    trimmed = trimmed.slice(0, -"/openai".length);
  }
  return trimmed;
}

function normalizeModelName(model: string): string {
  return model.trim().replace(/^models\//, "");
}

function buildGeminiEndpoint(
  baseUrl: string,
  model: string,
  stream: boolean
): string {
  const root = normalizeGeminiBaseUrl(baseUrl);
  const cleanModel = encodeURIComponent(normalizeModelName(model));
  return stream
    ? `${root}/models/${cleanModel}:streamGenerateContent?alt=sse`
    : `${root}/models/${cleanModel}:generateContent`;
}

export const geminiNativeProvider: ModelProvider = {
  id: "gemini-native",

  async testConnection(config: ModelConfig): Promise<ProviderTestResult> {
    const endpoint = buildGeminiEndpoint(config.baseUrl, config.model, false);
    const start = Date.now();
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey.trim(),
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with OK only." }] }],
          generationConfig: { maxOutputTokens: 64 },
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
        modelVersion?: string;
        candidates?: Array<{
          content?: { parts?: GeminiPart[] };
        }>;
      };

      const parts = data.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find((p) => typeof p.text === "string" && !p.thought);

      return {
        ok: true,
        latencyMs,
        model: data.modelVersion || normalizeModelName(config.model),
        reply: (textPart?.text || "OK").trim().slice(0, 80),
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
    const endpoint = buildGeminiEndpoint(
      init.config.baseUrl,
      init.config.model,
      true
    );
    const systemText = `${init.systemPrompt}\n\n${init.workspaceContext}`;
    const functionDeclarations = init.tools.map((t) => {
      const hasProps = Object.keys(t.parameters.properties || {}).length > 0;
      return hasProps
        ? {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }
        : {
            name: t.name,
            description: t.description,
          };
    });

    const contents: GeminiContent[] = [
      ...init.history.map((h) => ({
        role: (h.role === "assistant" ? "model" : "user") as "user" | "model",
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: [{ text: init.userPrompt }] },
    ];

    let callCounter = 0;

    return {
      async runTurn({ signal, onTextDelta }): Promise<ProviderTurnResult> {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": init.config.apiKey.trim(),
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents,
            tools: [{ functionDeclarations }],
            toolConfig: {
              functionCallingConfig: { mode: "AUTO" },
            },
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
        const toolCalls: ProviderToolCall[] = [];
        // Preserve raw model parts (including thoughtSignature!) for multi-turn Gemini 3/4 tool calls
        const preservedModelParts: GeminiPart[] = [];
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

            let chunk: {
              candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
              usageMetadata?: {
                promptTokenCount?: number;
                cachedContentTokenCount?: number;
                candidatesTokenCount?: number;
                thoughtsTokenCount?: number;
                totalTokenCount?: number;
              };
              error?: { message?: string };
            };
            try {
              chunk = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (chunk.error?.message) {
              throw new Error(`模型流式返回错误: ${chunk.error.message}`);
            }

            if (chunk.usageMetadata) {
              const rawInput = Math.max(
                0,
                Number(chunk.usageMetadata.promptTokenCount) || 0
              );
              const cachedInputTokens = Math.min(
                rawInput,
                Math.max(
                  0,
                  Number(chunk.usageMetadata.cachedContentTokenCount) || 0
                )
              );
              const inputTokens = Math.max(0, rawInput - cachedInputTokens);
              const rawOutput =
                (Number(chunk.usageMetadata.candidatesTokenCount) || 0) +
                (Number(chunk.usageMetadata.thoughtsTokenCount) || 0);
              const totalCount = Number(chunk.usageMetadata.totalTokenCount) || 0;
              const outputTokens = Math.max(
                0,
                rawOutput,
                totalCount > rawInput ? totalCount - rawInput : 0
              );
              usage = {
                inputTokens,
                cachedInputTokens,
                cacheWriteTokens: 0,
                outputTokens,
                totalTokens: Math.max(totalCount, rawInput + outputTokens),
              };
            }

            const parts = chunk.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) continue;

            for (const part of parts) {
              if (typeof part.text === "string" && part.text.length > 0) {
                if (part.thought) {
                  reasoning += part.text;
                  onTextDelta(part.text);
                } else {
                  content += part.text;
                  onTextDelta(part.text);
                }
                // Merge consecutive plain text parts to keep history compact while keeping signatures intact
                const last = preservedModelParts[preservedModelParts.length - 1];
                if (
                  last &&
                  typeof last.text === "string" &&
                  Boolean(last.thought) === Boolean(part.thought) &&
                  !last.thoughtSignature &&
                  !part.thoughtSignature &&
                  !last.functionCall
                ) {
                  last.text += part.text;
                } else {
                  preservedModelParts.push({ ...part });
                }
              } else if (part.functionCall && part.functionCall.name) {
                const callId =
                  part.functionCall.id ||
                  `gemini_call_${++callCounter}_${Date.now()}`;
                toolCalls.push({
                  id: callId,
                  name: part.functionCall.name,
                  argumentsStr: JSON.stringify(part.functionCall.args ?? {}),
                });
                preservedModelParts.push({ ...part });
              } else if (part.thoughtSignature) {
                preservedModelParts.push({ ...part });
              }
            }
          }
        }

        if (preservedModelParts.length > 0) {
          contents.push({ role: "model", parts: preservedModelParts });
        }

        return { content, reasoning, toolCalls, usage };
      },

      appendToolResults(results: ProviderToolResultInput[]) {
        contents.push({
          role: "user",
          parts: results.map((r) => ({
            functionResponse: {
              name: r.toolName,
              response: {
                ok: r.ok,
                result: r.output,
              },
            },
          })),
        });
      },

      appendUserFollowUp(content: string) {
        contents.push({
          role: "user",
          parts: [{ text: content }],
        });
      },
    };
  },
};
