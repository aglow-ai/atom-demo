import { NextRequest } from "next/server";
import { AGENT_TOOLS, executeAgentTool } from "@/lib/agent-tools";
import { compileProject, normalizeProjectFiles } from "@/lib/compiler";
import { REACT_AGENT_SYSTEM_PROMPT } from "@/lib/system-prompt";
import type {
  AgentStreamEvent,
  ModelConfig,
  ProjectFiles,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface IncomingHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface AgentRunRequest {
  prompt: string;
  files: ProjectFiles;
  history?: IncomingHistoryItem[];
  config: ModelConfig;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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

interface AccumulatedToolCall {
  id: string;
  name: string;
  argumentsStr: string;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function buildWorkspaceContextMessage(files: ProjectFiles): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) {
    return "当前虚拟工作区为空（尚无文件）。请从零设计并创建所需文件（入口必须为 src/App.tsx），完成后调用 validate_project 校验。";
  }
  const summary = paths
    .map((p) => `- ${p} (${files[p].split("\n").length} 行)`)
    .join("\n");
  return `当前虚拟工作区已有以下文件：\n${summary}\n\n如需修改现有逻辑，请先调用 read_file 查看相关文件内容再进行增量编辑或更新，最后调用 validate_project 校验。`;
}

async function callLLMStreaming(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  messages: OpenAIMessage[];
  signal: AbortSignal;
  onTextDelta: (delta: string) => void;
}): Promise<{
  content: string;
  reasoning: string;
  toolCalls: AccumulatedToolCall[];
}> {
  const response = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
      temperature: params.temperature,
      stream: true,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let detail = errText;
    try {
      const parsed = JSON.parse(errText);
      detail = parsed?.error?.message || parsed?.message || errText;
    } catch {
      // keep raw
    }
    throw new Error(
      `LLM API 返回错误 (HTTP ${response.status}): ${detail.slice(0, 400)}`
    );
  }

  if (!response.body) {
    throw new Error("LLM API 未返回流式响应体。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let content = "";
  let reasoning = "";
  const toolCallsMap = new Map<number, AccumulatedToolCall>();

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
      if (payload === "[DONE]") {
        continue;
      }

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

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        params.onTextDelta(delta.reasoning_content);
      }

      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        params.onTextDelta(delta.content);
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

  return { content, reasoning, toolCalls };
}

export async function POST(req: NextRequest) {
  let body: AgentRunRequest;
  try {
    body = (await req.json()) as AgentRunRequest;
  } catch {
    return new Response(JSON.stringify({ error: "无效的请求体" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const prompt = body.prompt?.trim();
  const config = body.config;

  if (!prompt) {
    return new Response(JSON.stringify({ error: "需求描述不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!config?.apiKey?.trim() || !config?.baseUrl?.trim() || !config?.model?.trim()) {
    return new Response(
      JSON.stringify({ error: "请先在右上角「模型设置」中配置有效的 API Key 与模型。" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const encoder = new TextEncoder();
  const maxIterations = Math.min(Math.max(Number(config.maxIterations) || 12, 2), 24);
  const temperature =
    typeof config.temperature === "number" ? config.temperature : 0.2;
  const endpoint = buildChatCompletionsUrl(config.baseUrl);
  const workingFiles: ProjectFiles = normalizeProjectFiles(body.files || {});
  const changedFilesSet = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const emit = (event: AgentStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const finishStream = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };

      try {
        const messages: OpenAIMessage[] = [
          { role: "system", content: REACT_AGENT_SYSTEM_PROMPT },
          { role: "system", content: buildWorkspaceContextMessage(workingFiles) },
        ];

        const recentHistory = (body.history || []).slice(-10);
        for (const item of recentHistory) {
          if (item.role === "user" || item.role === "assistant") {
            messages.push({
              role: item.role,
              content: item.content.slice(0, 4000),
            });
          }
        }

        messages.push({ role: "user", content: prompt });

        let finalSummary = "";
        let lastValidationPassed = false;
        let hasMutatedSinceValidation = false;
        let completedIterations = 0;

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
          if (req.signal.aborted) {
            break;
          }

          completedIterations = iteration;
          emit({ type: "iteration_start", iteration, maxIterations });

          const llmResult = await callLLMStreaming({
            endpoint,
            apiKey: config.apiKey.trim(),
            model: config.model.trim(),
            temperature,
            messages,
            signal: req.signal,
            onTextDelta: (delta) => {
              emit({ type: "thought_delta", iteration, delta });
            },
          });

          const combinedThought = [llmResult.reasoning, llmResult.content]
            .filter(Boolean)
            .join("\n\n")
            .trim();

          if (llmResult.toolCalls.length > 0) {
            if (combinedThought) {
              emit({
                type: "thought_done",
                iteration,
                content: combinedThought,
              });
            }

            messages.push({
              role: "assistant",
              content: llmResult.content || null,
              tool_calls: llmResult.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: tc.argumentsStr || "{}",
                },
              })),
            });

            let mutatedThisTurn = false;

            for (const tc of llmResult.toolCalls) {
              if (req.signal.aborted) break;

              let parsedArgs: Record<string, unknown> = {};
              let parseError: string | null = null;

              try {
                parsedArgs = tc.argumentsStr.trim()
                  ? (JSON.parse(tc.argumentsStr) as Record<string, unknown>)
                  : {};
              } catch (err) {
                parseError = `参数 JSON 解析失败: ${
                  err instanceof Error ? err.message : String(err)
                }`;
              }

              // For UI display, avoid flooding giant file content in args summary if unneeded,
              // but keep path & line count info clean.
              const uiArgs: Record<string, unknown> = { ...parsedArgs };
              if (typeof uiArgs.content === "string" && uiArgs.content.length > 300) {
                uiArgs.contentPreview = `${uiArgs.content.slice(0, 180)}... (${uiArgs.content.split("\n").length} lines)`;
                delete uiArgs.content;
              }

              emit({
                type: "tool_start",
                iteration,
                toolCallId: tc.id,
                toolName: tc.name,
                args: uiArgs,
              });

              const toolStartMs = Date.now();
              let ok = false;
              let resultText = "";

              if (parseError) {
                ok = false;
                resultText = parseError;
              } else {
                const outcome = executeAgentTool(
                  tc.name,
                  parsedArgs,
                  workingFiles
                );
                ok = outcome.ok;
                resultText = outcome.output;
                if (outcome.mutatedFile) {
                  changedFilesSet.add(outcome.mutatedFile);
                  mutatedThisTurn = true;
                  hasMutatedSinceValidation = true;
                  lastValidationPassed = false;
                }
                if (tc.name === "validate_project") {
                  lastValidationPassed = ok;
                  if (ok) hasMutatedSinceValidation = false;
                }
              }

              const durationMs = Date.now() - toolStartMs;

              emit({
                type: "tool_result",
                iteration,
                toolCallId: tc.id,
                toolName: tc.name,
                result: resultText,
                ok,
                durationMs,
              });

              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: resultText,
              });
            }

            if (mutatedThisTurn) {
              emit({
                type: "files_sync",
                files: { ...workingFiles },
                changedFiles: Array.from(changedFilesSet),
              });
            }

            continue;
          }

          // No tool calls -> agent intends to finish.
          // Guardrail: if files were mutated and never validated, run automatic validation check!
          if (hasMutatedSinceValidation && !lastValidationPassed && iteration < maxIterations) {
            const autoCheck = compileProject(workingFiles);
            if (!autoCheck.ok) {
              const autoErrSummary = autoCheck.errors
                .map(
                  (e, i) =>
                    `${i + 1}. [${e.file}${e.line ? `:${e.line}` : ""}] ${e.message}`
                )
                .join("\n");

              const autoToolId = `auto_validate_${iteration}`;
              emit({
                type: "tool_start",
                iteration,
                toolCallId: autoToolId,
                toolName: "validate_project",
                args: { auto: true },
              });
              emit({
                type: "tool_result",
                iteration,
                toolCallId: autoToolId,
                toolName: "validate_project",
                result: `自动校验发现 ${autoCheck.errors.length} 个错误：\n${autoErrSummary}`,
                ok: false,
                durationMs: 2,
              });

              messages.push({
                role: "assistant",
                content: llmResult.content || "已完成代码编写。",
              });
              messages.push({
                role: "user",
                content: `系统自动编译校验未通过，发现以下错误，请立即修复并调用 validate_project 确认通过：\n${autoErrSummary}`,
              });
              continue;
            }
          }

          finalSummary =
            llmResult.content.trim() ||
            "已完成应用代码生成与校验，你可以在右侧实时预览和体验。";
          break;
        }

        if (!finalSummary && !req.signal.aborted) {
          finalSummary =
            "已达到当前设定的最大智能体迭代步数，当前已生成的代码已同步至右侧工作区。如需继续优化，可直接继续对话或在设置中调高最大步数。";
        }

        emit({
          type: "done",
          summary: finalSummary,
          files: { ...workingFiles },
          changedFiles: Array.from(changedFilesSet),
          iterations: completedIterations,
        });
      } catch (err) {
        if (req.signal.aborted) {
          emit({ type: "error", message: "已手动停止当前生成任务。" });
        } else {
          emit({
            type: "error",
            message:
              err instanceof Error
                ? err.message
                : "智能体运行过程中发生未知错误。",
          });
        }
      } finally {
        finishStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
