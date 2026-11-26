import { AGENT_TOOLS, executeAgentTool } from "./agent-tools";
import { compileProject, normalizeProjectFiles } from "./compiler";
import {
  getSupabaseServerClient,
  PROJECTS_TABLE,
} from "./supabase-server";
import { REACT_AGENT_SYSTEM_PROMPT } from "./system-prompt";
import type {
  AgentStreamEvent,
  ChatMessage,
  ModelConfig,
  Project,
  ProjectFiles,
  ReActStep,
} from "./types";

interface ChatCompletionMessage {
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

interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const RESPONSES_TOOLS: ResponsesToolDefinition[] = AGENT_TOOLS.map((t) => ({
  type: "function",
  name: t.function.name,
  description: t.function.description,
  parameters: t.function.parameters,
}));

export type JobSubscriber = (event: AgentStreamEvent) => void;

export interface ActiveAgentJob {
  jobId: string;
  projectId: string;
  prompt: string;
  assistantMsgId: string;
  status: "running" | "done" | "error" | "aborted";
  projectState: Project;
  abortController: AbortController;
  subscribers: Set<JobSubscriber>;
  persistChain: Promise<void>;
  createdAt: number;
  finishedAt?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __atomsAgentJobs: Map<string, ActiveAgentJob> | undefined;
}

function getJobsMap(): Map<string, ActiveAgentJob> {
  if (!globalThis.__atomsAgentJobs) {
    globalThis.__atomsAgentJobs = new Map<string, ActiveAgentJob>();
  }
  return globalThis.__atomsAgentJobs;
}

function shouldUseResponsesApi(config: ModelConfig): boolean {
  const lower = config.baseUrl.trim().toLowerCase();
  if (lower.endsWith("/responses")) return true;
  if (lower.endsWith("/chat/completions")) return false;
  return config.provider === "openai" || lower.includes("api.openai.com");
}

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  return `${trimmed}/responses`;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
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

async function parseUpstreamError(response: Response): Promise<string> {
  const errText = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(errText);
    return String(parsed?.error?.message || parsed?.message || errText);
  } catch {
    return errText;
  }
}

async function persistProjectToSupabase(project: Project): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  try {
    await supabase.from(PROJECTS_TABLE).upsert(
      {
        id: project.id,
        name: project.name || "未命名应用",
        description: project.description || "",
        files: project.files,
        messages: project.messages,
        snapshots: project.snapshots,
        updated_at: new Date(project.updatedAt || Date.now()).toISOString(),
      },
      { onConflict: "id" }
    );
  } catch {
    // Non-fatal: keep background job running even if transient DB blip occurs
  }
}

function queuePersist(job: ActiveAgentJob): Promise<void> {
  const snapshotCopy: Project = {
    ...job.projectState,
    files: { ...job.projectState.files },
    messages: job.projectState.messages.map((m) => ({
      ...m,
      steps: m.steps ? m.steps.map((s) => ({ ...s })) : undefined,
    })),
    snapshots: [...job.projectState.snapshots],
  };
  job.persistChain = job.persistChain
    .then(() => persistProjectToSupabase(snapshotCopy))
    .catch(() => {});
  return job.persistChain;
}

function broadcast(job: ActiveAgentJob, event: AgentStreamEvent) {
  for (const sub of Array.from(job.subscribers)) {
    try {
      sub(event);
    } catch {
      job.subscribers.delete(sub);
    }
  }
}

function areFilesEqual(a: ProjectFiles, b: ProjectFiles): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in b) || a[key] !== b[key]) return false;
  }
  return true;
}

function cloneProject(project: Project): Project {
  return {
    ...project,
    files: { ...project.files },
    messages: project.messages.map((m) => ({
      ...m,
      steps: m.steps ? m.steps.map((s) => ({ ...s })) : undefined,
      filesChanged: m.filesChanged ? [...m.filesChanged] : undefined,
    })),
    snapshots: project.snapshots.map((s) => ({
      ...s,
      files: { ...s.files },
    })),
  };
}

/**
 * OpenAI Responses API (/v1/responses) streaming call
 */
async function callResponsesApiStreaming(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  instructions: string;
  input: Array<Record<string, unknown>>;
  previousResponseId?: string;
  signal: AbortSignal;
  onTextDelta: (delta: string) => void;
}): Promise<{
  responseId?: string;
  content: string;
  reasoning: string;
  toolCalls: AccumulatedToolCall[];
}> {
  const payload: Record<string, unknown> = {
    model: params.model,
    instructions: params.instructions,
    input: params.input,
    tools: RESPONSES_TOOLS,
    tool_choice: "auto",
    stream: true,
  };
  if (params.previousResponseId) {
    payload.previous_response_id = params.previousResponseId;
  }

  const response = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: params.signal,
  });

  if (!response.ok) {
    const detail = await parseUpstreamError(response);
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
  let responseId: string | undefined;
  let content = "";
  let reasoning = "";
  const toolCallsByItemId = new Map<string, AccumulatedToolCall>();
  const toolCallOrder: string[] = [];
  let completedOutputItems: Array<Record<string, unknown>> | null = null;

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

      if (evtType === "response.created" || evtType === "response.in_progress") {
        const resp = evt.response as { id?: string } | undefined;
        if (resp?.id) responseId = resp.id;
      } else if (evtType === "response.output_text.delta") {
        const delta = typeof evt.delta === "string" ? evt.delta : "";
        if (delta) {
          content += delta;
          params.onTextDelta(delta);
        }
      } else if (evtType === "response.reasoning_summary_text.delta") {
        const delta = typeof evt.delta === "string" ? evt.delta : "";
        if (delta) {
          reasoning += delta;
          params.onTextDelta(delta);
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
          const itemKey =
            item.id || item.call_id || `fc_${toolCallOrder.length}`;
          if (!toolCallsByItemId.has(itemKey)) {
            toolCallOrder.push(itemKey);
            toolCallsByItemId.set(itemKey, {
              id: item.call_id || itemKey,
              name: item.name || "",
              argumentsStr: item.arguments || "",
            });
          }
        }
      } else if (evtType === "response.function_call_arguments.delta") {
        const itemKey = String(evt.item_id || "");
        const delta = typeof evt.delta === "string" ? evt.delta : "";
        if (itemKey && delta) {
          const existing = toolCallsByItemId.get(itemKey);
          if (existing) {
            existing.argumentsStr += delta;
          }
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
          const itemKey =
            item.id || item.call_id || `fc_${toolCallOrder.length}`;
          if (!toolCallsByItemId.has(itemKey)) {
            toolCallOrder.push(itemKey);
          }
          toolCallsByItemId.set(itemKey, {
            id: item.call_id || itemKey,
            name: item.name || "",
            argumentsStr: item.arguments || "",
          });
        }
      } else if (evtType === "response.completed") {
        const resp = evt.response as
          | { id?: string; output?: Array<Record<string, unknown>> }
          | undefined;
        if (resp?.id) responseId = resp.id;
        if (Array.isArray(resp?.output)) {
          completedOutputItems = resp.output;
        }
      } else if (evtType === "response.failed" || evtType === "error") {
        const errObj = (evt.error ||
          (evt.response as { error?: { message?: string } } | undefined)
            ?.error) as { message?: string } | undefined;
        throw new Error(errObj?.message || "模型流式响应失败。");
      }
    }
  }

  let toolCalls: AccumulatedToolCall[] = toolCallOrder
    .map((k) => toolCallsByItemId.get(k)!)
    .filter((tc) => tc && tc.name.trim().length > 0);

  if (completedOutputItems) {
    const fromCompleted: AccumulatedToolCall[] = [];
    for (const item of completedOutputItems) {
      if (item.type === "function_call" && typeof item.name === "string") {
        fromCompleted.push({
          id: String(item.call_id || item.id || `call_${fromCompleted.length}`),
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

  return { responseId, content, reasoning, toolCalls };
}

/**
 * Standard Chat Completions API (/v1/chat/completions) streaming call
 */
async function callChatCompletionsStreaming(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: ChatCompletionMessage[];
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
      stream: true,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const detail = await parseUpstreamError(response);
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

      if (
        typeof delta.reasoning_content === "string" &&
        delta.reasoning_content
      ) {
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

function patchAssistantMessage(
  job: ActiveAgentJob,
  patcher: (msg: ChatMessage) => ChatMessage
) {
  job.projectState = {
    ...job.projectState,
    updatedAt: Date.now(),
    messages: job.projectState.messages.map((m) =>
      m.id === job.assistantMsgId ? patcher(m) : m
    ),
  };
}

export function getAgentJob(projectId: string): ActiveAgentJob | undefined {
  return getJobsMap().get(projectId);
}

export function stopAgentJob(projectId: string): boolean {
  const job = getJobsMap().get(projectId);
  if (!job || job.status !== "running") return false;
  job.abortController.abort();
  return true;
}

export function startBackgroundAgentJob(params: {
  project: Project;
  prompt: string;
  config: ModelConfig;
}): { job: ActiveAgentJob; alreadyRunning: boolean } {
  const jobs = getJobsMap();
  const existing = jobs.get(params.project.id);
  if (existing && existing.status === "running") {
    return { job: existing, alreadyRunning: true };
  }

  const now = Date.now();
  const prompt = params.prompt.trim();
  const baseProject = cloneProject(params.project);
  baseProject.files = normalizeProjectFiles(baseProject.files || {});

  const shouldAutoName =
    baseProject.messages.length === 0 &&
    (baseProject.name === "未命名应用" ||
      /^(?:新)?应用 #\d+$/.test(baseProject.name));

  const userMsg: ChatMessage = {
    id: `msg_u_${now}`,
    role: "user",
    content: prompt,
    createdAt: now,
  };
  const assistantMsgId = `msg_a_${now + 1}`;
  const assistantMsg: ChatMessage = {
    id: assistantMsgId,
    role: "assistant",
    content: "",
    steps: [],
    status: "streaming",
    createdAt: now + 1,
  };

  const historySnapshot = baseProject.messages
    .filter((m) => m.content.trim().length > 0)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  baseProject.name = shouldAutoName
    ? prompt.replace(/\s+/g, " ").slice(0, 18)
    : baseProject.name;
  baseProject.description = baseProject.description || prompt.slice(0, 140);
  baseProject.messages = [...baseProject.messages, userMsg, assistantMsg];
  baseProject.updatedAt = now;

  const job: ActiveAgentJob = {
    jobId: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: baseProject.id,
    prompt,
    assistantMsgId,
    status: "running",
    projectState: baseProject,
    abortController: new AbortController(),
    subscribers: new Set<JobSubscriber>(),
    persistChain: Promise.resolve(),
    createdAt: now,
  };

  jobs.set(baseProject.id, job);

  // Immediately persist user message + streaming placeholder to Supabase
  queuePersist(job);

  // Detach and run the ReAct loop completely independent of HTTP request lifecycle
  void runJobLoop(job, historySnapshot, params.config);

  return { job, alreadyRunning: false };
}

async function runJobLoop(
  job: ActiveAgentJob,
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>,
  config: ModelConfig
): Promise<void> {
  const signal = job.abortController.signal;
  const maxIterations = Math.min(
    Math.max(Number(config.maxIterations) || 12, 2),
    24
  );
  const useResponses = shouldUseResponsesApi(config);
  const endpoint = useResponses
    ? buildResponsesUrl(config.baseUrl)
    : buildChatCompletionsUrl(config.baseUrl);

  const initialFiles: ProjectFiles = { ...job.projectState.files };
  const workingFiles: ProjectFiles = { ...job.projectState.files };
  const changedFilesSet = new Set<string>();

  try {
    const workspaceContext = buildWorkspaceContextMessage(workingFiles);
    const combinedInstructions = `${REACT_AGENT_SYSTEM_PROMPT}\n\n${workspaceContext}`;
    let previousResponseId: string | undefined;
    let nextResponsesInput: Array<Record<string, unknown>> = [
      ...recentHistory.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      { role: "user", content: job.prompt },
    ];

    const chatMessages: ChatCompletionMessage[] = [
      { role: "system", content: REACT_AGENT_SYSTEM_PROMPT },
      { role: "system", content: workspaceContext },
      ...recentHistory.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      { role: "user", content: job.prompt },
    ];

    let finalSummary = "";
    let lastValidationPassed = false;
    let hasMutatedSinceValidation = false;
    let completedIterations = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (signal.aborted) break;

      completedIterations = iteration;
      broadcast(job, { type: "iteration_start", iteration, maxIterations });

      const onTextDelta = (delta: string) => {
        patchAssistantMessage(job, (m) => {
          const steps = [...(m.steps ?? [])];
          const thoughtId = `thought_${iteration}`;
          const idx = steps.findIndex((s) => s.id === thoughtId);
          if (idx === -1) {
            steps.push({
              id: thoughtId,
              iteration,
              type: "thought",
              content: delta,
              status: "running",
              timestamp: Date.now(),
            });
          } else {
            steps[idx] = {
              ...steps[idx],
              content: (steps[idx].content ?? "") + delta,
            };
          }
          return { ...m, steps };
        });
        broadcast(job, { type: "thought_delta", iteration, delta });
      };

      let content = "";
      let reasoning = "";
      let toolCalls: AccumulatedToolCall[] = [];

      if (useResponses) {
        const res = await callResponsesApiStreaming({
          endpoint,
          apiKey: config.apiKey.trim(),
          model: config.model.trim(),
          instructions: combinedInstructions,
          input: nextResponsesInput,
          previousResponseId,
          signal,
          onTextDelta,
        });
        if (res.responseId) previousResponseId = res.responseId;
        content = res.content;
        reasoning = res.reasoning;
        toolCalls = res.toolCalls;
      } else {
        const res = await callChatCompletionsStreaming({
          endpoint,
          apiKey: config.apiKey.trim(),
          model: config.model.trim(),
          messages: chatMessages,
          signal,
          onTextDelta,
        });
        content = res.content;
        reasoning = res.reasoning;
        toolCalls = res.toolCalls;
      }

      const combinedThought = [reasoning, content]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (toolCalls.length > 0) {
        if (combinedThought) {
          patchAssistantMessage(job, (m) => {
            const steps = [...(m.steps ?? [])];
            const thoughtId = `thought_${iteration}`;
            const idx = steps.findIndex((s) => s.id === thoughtId);
            if (idx === -1) {
              steps.push({
                id: thoughtId,
                iteration,
                type: "thought",
                content: combinedThought,
                status: "success",
                timestamp: Date.now(),
              });
            } else {
              steps[idx] = {
                ...steps[idx],
                content: combinedThought,
                status: "success",
              };
            }
            return { ...m, steps };
          });
          broadcast(job, {
            type: "thought_done",
            iteration,
            content: combinedThought,
          });
        }

        if (!useResponses) {
          chatMessages.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: tc.argumentsStr || "{}",
              },
            })),
          });
        }

        const responsesToolOutputs: Array<Record<string, unknown>> = [];
        let mutatedThisTurn = false;

        for (const tc of toolCalls) {
          if (signal.aborted) break;

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

          const uiArgs: Record<string, unknown> = { ...parsedArgs };
          if (
            typeof uiArgs.content === "string" &&
            uiArgs.content.length > 300
          ) {
            uiArgs.contentPreview = `${uiArgs.content.slice(0, 180)}... (${
              uiArgs.content.split("\n").length
            } lines)`;
            delete uiArgs.content;
          }

          patchAssistantMessage(job, (m) => {
            const steps: ReActStep[] = [
              ...(m.steps ?? []).map((s) =>
                s.type === "thought" && s.iteration === iteration
                  ? { ...s, status: "success" as const }
                  : s
              ),
              {
                id: tc.id,
                iteration,
                type: "tool_call",
                toolCallId: tc.id,
                toolName: tc.name,
                toolArgs: uiArgs,
                status: "running",
                timestamp: Date.now(),
              },
            ];
            return { ...m, steps };
          });

          broadcast(job, {
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

          patchAssistantMessage(job, (m) => ({
            ...m,
            steps: (m.steps ?? []).map((s) =>
              s.id === tc.id
                ? {
                    ...s,
                    toolResult: resultText,
                    status: (ok ? "success" : "error") as "success" | "error",
                    durationMs,
                  }
                : s
            ),
          }));

          broadcast(job, {
            type: "tool_result",
            iteration,
            toolCallId: tc.id,
            toolName: tc.name,
            result: resultText,
            ok,
            durationMs,
          });

          if (useResponses) {
            responsesToolOutputs.push({
              type: "function_call_output",
              call_id: tc.id,
              output: resultText,
            });
          } else {
            chatMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: resultText,
            });
          }
        }

        if (useResponses) {
          nextResponsesInput = responsesToolOutputs;
        }

        if (mutatedThisTurn) {
          const changed = Array.from(changedFilesSet);
          job.projectState = {
            ...job.projectState,
            files: { ...workingFiles },
            updatedAt: Date.now(),
          };
          broadcast(job, {
            type: "files_sync",
            files: { ...workingFiles },
            changedFiles: changed,
          });
          // Save incremental progress to Supabase
          queuePersist(job);
        }

        continue;
      }

      // Guardrail: auto-validate if files were mutated and not yet validated
      if (
        hasMutatedSinceValidation &&
        !lastValidationPassed &&
        iteration < maxIterations
      ) {
        const autoCheck = compileProject(workingFiles);
        if (!autoCheck.ok) {
          const autoErrSummary = autoCheck.errors
            .map(
              (e, i) =>
                `${i + 1}. [${e.file}${e.line ? `:${e.line}` : ""}] ${e.message}`
            )
            .join("\n");

          const autoToolId = `auto_validate_${iteration}`;
          const autoResult = `自动校验发现 ${autoCheck.errors.length} 个错误：\n${autoErrSummary}`;

          patchAssistantMessage(job, (m) => ({
            ...m,
            steps: [
              ...(m.steps ?? []),
              {
                id: autoToolId,
                iteration,
                type: "tool_call",
                toolCallId: autoToolId,
                toolName: "validate_project",
                toolArgs: { auto: true },
                toolResult: autoResult,
                status: "error",
                durationMs: 2,
                timestamp: Date.now(),
              },
            ],
          }));

          broadcast(job, {
            type: "tool_start",
            iteration,
            toolCallId: autoToolId,
            toolName: "validate_project",
            args: { auto: true },
          });
          broadcast(job, {
            type: "tool_result",
            iteration,
            toolCallId: autoToolId,
            toolName: "validate_project",
            result: autoResult,
            ok: false,
            durationMs: 2,
          });

          const fixInstruction = `系统自动校验未通过，发现以下错误，请立即修复并调用 validate_project 确认通过：\n${autoErrSummary}`;
          if (useResponses) {
            nextResponsesInput = [{ role: "user", content: fixInstruction }];
          } else {
            chatMessages.push({
              role: "assistant",
              content: content || "已完成代码编写。",
            });
            chatMessages.push({
              role: "user",
              content: fixInstruction,
            });
          }
          continue;
        }
      }

      finalSummary =
        content.trim() ||
        "已完成应用生成与校验，你可以在右侧实时预览和体验。";
      break;
    }

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (!finalSummary) {
      finalSummary =
        "已达到当前设定的最大执行步数，当前生成的代码已同步至右侧工作区。如需继续优化，可直接继续对话或在模型设置中调高最大步数。";
    }

    const rawChangedFiles = Array.from(changedFilesSet);
    const hasCodeChanges =
      rawChangedFiles.length > 0 && !areFilesEqual(initialFiles, workingFiles);
    const changedFiles = hasCodeChanges ? rawChangedFiles : [];
    const snapId =
      hasCodeChanges && Object.keys(workingFiles).length > 0
        ? `snap_${Date.now()}`
        : undefined;

    const nextSnapshots = snapId
      ? [
          ...job.projectState.snapshots.slice(-14),
          {
            id: snapId,
            label: job.prompt.replace(/\s+/g, " ").slice(0, 22),
            files: { ...workingFiles },
            createdAt: Date.now(),
          },
        ]
      : job.projectState.snapshots;

    job.projectState = {
      ...job.projectState,
      files: { ...workingFiles },
      snapshots: nextSnapshots,
      updatedAt: Date.now(),
      messages: job.projectState.messages.map((m) => {
        if (m.id !== job.assistantMsgId) return m;
        const cleanedSteps = (m.steps ?? [])
          .map((s) =>
            s.status === "running" ? { ...s, status: "success" as const } : s
          )
          .filter((s, i, arr) => {
            if (
              i === arr.length - 1 &&
              s.type === "thought" &&
              s.content?.trim() === finalSummary.trim()
            ) {
              return false;
            }
            return true;
          });
        return {
          ...m,
          content: finalSummary,
          steps: cleanedSteps,
          filesChanged: changedFiles,
          snapshotId: snapId,
          status: "done",
        };
      }),
    };

    job.status = "done";
    job.finishedAt = Date.now();

    await queuePersist(job);

    broadcast(job, {
      type: "done",
      summary: finalSummary,
      files: { ...workingFiles },
      changedFiles,
      iterations: completedIterations,
      snapshotId: snapId,
      project: cloneProject(job.projectState),
    });
  } catch (err) {
    const isAbort =
      signal.aborted || (err instanceof Error && err.name === "AbortError");
    const errMsg = isAbort
      ? "已手动停止当前生成任务。"
      : err instanceof Error
      ? err.message
      : "智能体运行过程中发生未知错误。";

    job.status = isAbort ? "aborted" : "error";
    job.finishedAt = Date.now();

    patchAssistantMessage(job, (m) => ({
      ...m,
      status: isAbort ? "aborted" : "error",
      error: errMsg,
      steps: (m.steps ?? []).map((s) =>
        s.status === "running" ? { ...s, status: "error" } : s
      ),
    }));

    await queuePersist(job);

    broadcast(job, {
      type: "error",
      message: errMsg,
      aborted: isAbort,
    });
  } finally {
    // Keep finished job snapshot cached briefly (2 min) for quick page reloads, then release
    const finishedJobId = job.jobId;
    setTimeout(() => {
      const jobs = getJobsMap();
      const cur = jobs.get(job.projectId);
      if (cur && cur.jobId === finishedJobId && cur.status !== "running") {
        jobs.delete(job.projectId);
      }
    }, 120_000);
  }
}
