import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_TOOLS, executeAgentTool } from "./agent-tools";
import { compileProject, normalizeProjectFiles } from "./compiler";
import { deductUserCredits } from "./credits";
import {
  resolveModelProvider,
  type ProviderToolResultInput,
  type ProviderToolSpec,
} from "./providers";
import {
  PROJECTS_TABLE,
  rowToProject,
  type SupabaseProjectRow,
} from "./supabase-server";
import { calculateCreditsFromTokens } from "./system-model";
import { REACT_AGENT_SYSTEM_PROMPT } from "./system-prompt";
import type {
  AgentStreamEvent,
  ChatMessage,
  MessageUsageInfo,
  ModelConfig,
  ModelConfigMode,
  Project,
  ProjectFiles,
  ReActStep,
} from "./types";

const JOB_STALE_MS = 5 * 60 * 1000; // 5 min heartbeat expiry for crashed serverless containers

const PROVIDER_TOOL_SPECS: ProviderToolSpec[] = AGENT_TOOLS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  parameters: t.function.parameters,
}));

export type JobSubscriber = (event: AgentStreamEvent) => void;

export interface ActiveAgentJob {
  jobId: string;
  projectId: string;
  userId: string;
  billingMode: ModelConfigMode;
  supabase: SupabaseClient;
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

export interface RemoteJobState {
  project: Project;
  agentStatus:
    | "idle"
    | "running"
    | "stop_requested"
    | "done"
    | "error"
    | "aborted";
  agentJobId: string | null;
  agentUpdatedAt: number;
  isStale: boolean;
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

async function persistInitialJobState(job: ActiveAgentJob): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await job.supabase
      .from(PROJECTS_TABLE)
      .update({
        name: job.projectState.name || "未命名应用",
        description: job.projectState.description || "",
        files: job.projectState.files,
        messages: job.projectState.messages,
        snapshots: job.projectState.snapshots,
        agent_status: "running",
        agent_job_id: job.jobId,
        agent_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", job.projectState.id)
      .eq("user_id", job.userId);
  } catch {
    // Non-fatal fallback
  }
}

async function persistProgressToSupabase(
  supabase: SupabaseClient,
  userId: string,
  project: Project,
  jobId: string,
  finalStatus?: "done" | "error" | "aborted"
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const payload: Record<string, unknown> = {
      name: project.name || "未命名应用",
      description: project.description || "",
      files: project.files,
      messages: project.messages,
      snapshots: project.snapshots,
      agent_updated_at: nowIso,
      updated_at: nowIso,
    };
    if (finalStatus) {
      payload.agent_status = finalStatus;
    }

    await supabase
      .from(PROJECTS_TABLE)
      .update(payload)
      .eq("id", project.id)
      .eq("user_id", userId)
      .eq("agent_job_id", jobId);
  } catch {
    // Non-fatal
  }
}

function queuePersist(
  job: ActiveAgentJob,
  finalStatus?: "done" | "error" | "aborted"
): Promise<void> {
  const snapshotCopy = cloneProject(job.projectState);
  const jobId = job.jobId;
  const supabase = job.supabase;
  const userId = job.userId;
  job.persistChain = job.persistChain
    .then(() =>
      persistProgressToSupabase(supabase, userId, snapshotCopy, jobId, finalStatus)
    )
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

export async function fetchRemoteProjectJobState(
  supabase: SupabaseClient,
  userId: string,
  projectId: string
): Promise<RemoteJobState | null> {
  const { data, error } = await supabase
    .from(PROJECTS_TABLE)
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as SupabaseProjectRow;
  const project = rowToProject(row);
  const rawStatus = (row.agent_status || "idle") as RemoteJobState["agentStatus"];
  const agentUpdatedAt = row.agent_updated_at
    ? new Date(row.agent_updated_at).getTime()
    : project.updatedAt;
  const isStale =
    (rawStatus === "running" || rawStatus === "stop_requested") &&
    Date.now() - agentUpdatedAt > JOB_STALE_MS;

  return {
    project,
    agentStatus: isStale ? "error" : rawStatus,
    agentJobId: row.agent_job_id || null,
    agentUpdatedAt,
    isStale,
  };
}

async function isStopRequestedInSupabase(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  jobId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from(PROJECTS_TABLE)
      .select("agent_status, agent_job_id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return false;
    return (
      data.agent_job_id === jobId && data.agent_status === "stop_requested"
    );
  } catch {
    return false;
  }
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

export function getAgentJob(
  projectId: string,
  userId: string
): ActiveAgentJob | undefined {
  const job = getJobsMap().get(projectId);
  if (!job || job.userId !== userId) return undefined;
  return job;
}

export async function requestStopAgentJob(
  supabase: SupabaseClient,
  userId: string,
  projectId: string
): Promise<boolean> {
  let stopped = false;

  const localJob = getJobsMap().get(projectId);
  if (localJob && localJob.userId === userId && localJob.status === "running") {
    localJob.abortController.abort();
    stopped = true;
  }

  try {
    const { data } = await supabase
      .from(PROJECTS_TABLE)
      .update({
        agent_status: "stop_requested",
        agent_updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId)
      .eq("agent_status", "running")
      .select("id");
    if (Array.isArray(data) && data.length > 0) {
      stopped = true;
    }
  } catch {
    // ignore
  }

  return stopped;
}

export async function prepareBackgroundAgentJob(params: {
  supabase: SupabaseClient;
  backgroundSupabase: SupabaseClient;
  userId: string;
  billingMode: ModelConfigMode;
  project: Project;
  prompt: string;
  config: ModelConfig;
}): Promise<{
  alreadyRunning: boolean;
  jobId: string;
  project: Project;
  execute?: () => Promise<void>;
}> {
  const jobs = getJobsMap();
  const existingLocal = jobs.get(params.project.id);
  if (
    existingLocal &&
    existingLocal.userId === params.userId &&
    existingLocal.status === "running"
  ) {
    return {
      alreadyRunning: true,
      jobId: existingLocal.jobId,
      project: cloneProject(existingLocal.projectState),
    };
  }

  const remoteState = await fetchRemoteProjectJobState(
    params.supabase,
    params.userId,
    params.project.id
  );
  if (
    remoteState &&
    !remoteState.isStale &&
    (remoteState.agentStatus === "running" ||
      remoteState.agentStatus === "stop_requested")
  ) {
    return {
      alreadyRunning: true,
      jobId: remoteState.agentJobId || `remote_${params.project.id}`,
      project: remoteState.project,
    };
  }

  const now = Date.now();
  const prompt = params.prompt.trim();
  const baseProject = cloneProject(
    remoteState ? remoteState.project : params.project
  );
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
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as
        | "user"
        | "assistant",
      content:
        m.role === "system"
          ? `[系统状态通知] ${m.content.slice(0, 500)}（请以当前工作区最新文件内容为准）`
          : m.content.slice(0, 4000),
    }));

  baseProject.name = shouldAutoName
    ? prompt.replace(/\s+/g, " ").slice(0, 18)
    : baseProject.name;
  baseProject.description = baseProject.description || prompt.slice(0, 140);
  baseProject.messages = [...baseProject.messages, userMsg, assistantMsg];
  baseProject.updatedAt = now;

  const job: ActiveAgentJob = {
    jobId: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: baseProject.id,
    userId: params.userId,
    billingMode: params.billingMode,
    supabase: params.backgroundSupabase,
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

  await persistInitialJobState(job);

  return {
    alreadyRunning: false,
    jobId: job.jobId,
    project: cloneProject(job.projectState),
    execute: () => runJobLoop(job, historySnapshot, params.config),
  };
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

  const initialFiles: ProjectFiles = { ...job.projectState.files };
  const workingFiles: ProjectFiles = { ...job.projectState.files };
  const changedFilesSet = new Set<string>();

  const provider = resolveModelProvider(config);
  const session = provider.createSession({
    config,
    systemPrompt: REACT_AGENT_SYSTEM_PROMPT,
    workspaceContext: buildWorkspaceContextMessage(workingFiles),
    history: recentHistory,
    userPrompt: job.prompt,
    tools: PROVIDER_TOOL_SPECS,
  });

  let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDeltaPersist = () => {
    if (deltaFlushTimer) return;
    deltaFlushTimer = setTimeout(() => {
      deltaFlushTimer = null;
      if (job.status === "running") {
        void queuePersist(job);
      }
    }, 750);
  };

  const stopPollTimer = setInterval(() => {
    if (signal.aborted || job.status !== "running") return;
    void isStopRequestedInSupabase(
      job.supabase,
      job.userId,
      job.projectId,
      job.jobId
    ).then((stopReq) => {
      if (stopReq && !signal.aborted) {
        job.abortController.abort();
      }
    });
  }, 1200);

  let totalInputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalOutputTokens = 0;
  let completedTurns = 0;

  const workspaceContextChars =
    REACT_AGENT_SYSTEM_PROMPT.length +
    buildWorkspaceContextMessage(workingFiles).length +
    job.prompt.length;

  const settleBilling = async (): Promise<MessageUsageInfo | undefined> => {
    const totalTokens =
      totalInputTokens +
      totalCachedInputTokens +
      totalCacheWriteTokens +
      totalOutputTokens;

    if (completedTurns === 0 && totalTokens === 0) {
      return undefined;
    }

    if (job.billingMode !== "system") {
      return {
        billingMode: "custom",
        model: config.model,
        inputTokens: totalInputTokens,
        cachedInputTokens: totalCachedInputTokens,
        cacheWriteTokens: totalCacheWriteTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        creditsCharged: 0,
      };
    }

    const creditsToCharge = calculateCreditsFromTokens({
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      outputTokens: totalOutputTokens,
    });

    const deducted =
      creditsToCharge > 0
        ? await deductUserCredits(job.supabase, {
            userId: job.userId,
            amount: creditsToCharge,
            projectId: job.projectId,
            jobId: job.jobId,
            model: config.model,
            inputTokens: totalInputTokens,
            cachedInputTokens: totalCachedInputTokens,
            cacheWriteTokens: totalCacheWriteTokens,
            outputTokens: totalOutputTokens,
          })
        : null;

    return {
      billingMode: "system",
      model: config.model,
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      creditsCharged: deducted ? deducted.charged : creditsToCharge,
      balanceAfter: deducted?.balance,
    };
  };

  try {
    let finalSummary = "";
    let lastValidationPassed = false;
    let hasMutatedSinceValidation = false;
    let completedIterations = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (signal.aborted) break;
      if (
        await isStopRequestedInSupabase(
          job.supabase,
          job.userId,
          job.projectId,
          job.jobId
        )
      ) {
        job.abortController.abort();
        break;
      }

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
        scheduleDeltaPersist();
      };

      const { content, reasoning, toolCalls, usage } = await session.runTurn({
        signal,
        onTextDelta,
      });

      completedTurns += 1;
      if (
        usage &&
        (usage.inputTokens > 0 ||
          usage.cachedInputTokens > 0 ||
          usage.cacheWriteTokens > 0 ||
          usage.outputTokens > 0)
      ) {
        totalInputTokens += usage.inputTokens;
        totalCachedInputTokens += usage.cachedInputTokens;
        totalCacheWriteTokens += usage.cacheWriteTokens;
        totalOutputTokens += usage.outputTokens;
      } else {
        // Conservative fallback estimation when an upstream proxy omits streaming usage
        const toolArgsChars = toolCalls.reduce(
          (sum, tc) => sum + tc.name.length + tc.argumentsStr.length,
          0
        );
        const estimatedOut = Math.max(
          1,
          Math.ceil((content.length + reasoning.length + toolArgsChars) / 4)
        );
        const estimatedIn = Math.max(
          1,
          Math.ceil((workspaceContextChars + iteration * 1200) / 4)
        );
        totalInputTokens += estimatedIn;
        totalOutputTokens += estimatedOut;
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

        const toolResults: ProviderToolResultInput[] = [];
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
          void queuePersist(job);

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

          toolResults.push({
            callId: tc.id,
            toolName: tc.name,
            output: resultText,
            ok,
          });
        }

        session.appendToolResults(toolResults);

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
        }
        void queuePersist(job);

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
          void queuePersist(job);

          session.appendUserFollowUp(
            `系统自动校验未通过，发现以下错误，请立即修复并调用 validate_project 确认通过：\n${autoErrSummary}`
          );
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

    const usageInfo = await settleBilling();

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
          usage: usageInfo,
          status: "done",
        };
      }),
    };

    job.status = "done";
    job.finishedAt = Date.now();

    await queuePersist(job, "done");

    broadcast(job, {
      type: "done",
      summary: finalSummary,
      files: { ...workingFiles },
      changedFiles,
      iterations: completedIterations,
      snapshotId: snapId,
      usage: usageInfo,
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

    const terminalStatus = isAbort ? "aborted" : "error";
    job.status = terminalStatus;
    job.finishedAt = Date.now();

    const usageInfo = await settleBilling();

    patchAssistantMessage(job, (m) => ({
      ...m,
      status: terminalStatus,
      error: errMsg,
      usage: usageInfo,
      steps: (m.steps ?? []).map((s) =>
        s.status === "running" ? { ...s, status: "error" } : s
      ),
    }));

    await queuePersist(job, terminalStatus);

    broadcast(job, {
      type: "error",
      message: errMsg,
      aborted: isAbort,
    });
  } finally {
    if (deltaFlushTimer) clearTimeout(deltaFlushTimer);
    clearInterval(stopPollTimer);

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
