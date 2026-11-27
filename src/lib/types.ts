export type ModelProviderId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "deepseek"
  | "openrouter"
  | "custom";

export interface ModelPreset {
  id: ModelProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  keyPlaceholder: string;
  docsHint: string;
}

export type ModelConfigMode = "system" | "custom";

export interface ModelConfig {
  mode?: ModelConfigMode;
  provider: ModelProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
}

export interface SystemModelPublicInfo {
  available: boolean;
  provider: ModelProviderId;
  model: string;
  maxIterations: number;
  inputTokensPerCredit: number;
  cachedInputTokensPerCredit: number;
  cacheWriteTokensPerCredit: number;
  outputTokensPerCredit: number;
  minCreditsPerRun: number;
  initialCredits: number;
}

export interface UserCreditsInfo {
  balance: number;
  totalGranted: number;
  totalSpent: number;
}

export interface CreditTransactionItem {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  projectId: string | null;
  jobId: string | null;
  model: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  createdAt: number;
}

export interface BillingSnapshot {
  systemModel: SystemModelPublicInfo;
  credits: UserCreditsInfo | null;
  recentTransactions: CreditTransactionItem[];
}

export interface MessageUsageInfo {
  billingMode: ModelConfigMode;
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  totalTokens: number;
  creditsCharged: number;
  balanceAfter?: number;
}

export type ProjectFiles = Record<string, string>;

export interface ReActStep {
  id: string;
  iteration: number;
  type: "thought" | "tool_call";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  status: "running" | "success" | "error";
  durationMs?: number;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  steps?: ReActStep[];
  filesChanged?: string[];
  snapshotId?: string;
  status?: "streaming" | "done" | "error" | "aborted";
  error?: string;
  usage?: MessageUsageInfo;
  createdAt: number;
}

export interface ProjectSnapshot {
  id: string;
  label: string;
  files: ProjectFiles;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  files: ProjectFiles;
  messages: ChatMessage[];
  snapshots: ProjectSnapshot[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  fileCount: number;
  snapshotCount: number;
  messageCount: number;
  fileNames: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SupabaseStatusInfo {
  configured: boolean;
  connected: boolean;
  tableReady: boolean;
  storageMode: "supabase" | "local";
  urlHost?: string;
  error?: string;
}

export interface RuntimeErrorPayload {
  type: "runtime" | "unhandledrejection" | "react" | "console";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  col?: number;
  timestamp: number;
}

export interface CompileError {
  file: string;
  message: string;
  line?: number;
  column?: number;
}

export interface CompileResult {
  ok: boolean;
  entryFile: string | null;
  compiledModules: Record<string, string>;
  cssContent: string;
  externalPackages: string[];
  errors: CompileError[];
  warnings: string[];
}

export type AgentStreamEvent =
  | { type: "idle" }
  | {
      type: "job_snapshot";
      jobId: string;
      status: "running" | "done" | "error" | "aborted";
      project: Project;
    }
  | { type: "iteration_start"; iteration: number; maxIterations: number }
  | { type: "thought_delta"; iteration: number; delta: string }
  | { type: "thought_done"; iteration: number; content: string }
  | {
      type: "tool_start";
      iteration: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      iteration: number;
      toolCallId: string;
      toolName: string;
      result: string;
      ok: boolean;
      durationMs: number;
    }
  | { type: "files_sync"; files: ProjectFiles; changedFiles: string[] }
  | { type: "answer_delta"; delta: string }
  | {
      type: "done";
      summary: string;
      files: ProjectFiles;
      changedFiles: string[];
      iterations: number;
      snapshotId?: string;
      usage?: MessageUsageInfo;
      project?: Project;
    }
  | { type: "error"; message: string; aborted?: boolean };

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-6.2-sol",
    suggestedModels: [
      "gpt-6.2-astra",
      "gpt-6.2-sol",
      "gpt-6.1-terra",
      "gpt-6-luna",
    ],
    keyPlaceholder: "sk-...",
    docsHint: "支持 OpenAI 官方 API Key（GPT-6 系列）",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-4-hydrogen",
    suggestedModels: [
      "gemini-4-hydrogen",
      "gemini-4-argon",
      "gemini-4-neon",
      "gemini-3.8-flash",
    ],
    keyPlaceholder: "AIza...",
    docsHint: "使用 Google Gemini 官方原生接口（Gemini 4 / 3.8 系列）",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5-5",
    suggestedModels: [
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-2",
      "claude-haiku-5-5",
    ],
    keyPlaceholder: "sk-ant-...",
    docsHint: "使用 Anthropic 官方原生接口（Claude 5 系列）",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-pro",
    suggestedModels: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash"],
    keyPlaceholder: "sk-...",
    docsHint: "使用 DeepSeek V4 官方接口",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-5-5",
    suggestedModels: [
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-opus-5.5",
      "openai/gpt-6.2-sol",
      "google/gemini-4-hydrogen",
      "deepseek/deepseek-v4.1-flash",
    ],
    keyPlaceholder: "sk-or-...",
    docsHint: "通过 OpenRouter 调用最新主流模型",
  },
  {
    id: "custom",
    name: "自定义接口",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-6.2-sol",
    suggestedModels: [],
    keyPlaceholder: "输入 API Key",
    docsHint: "支持自定义接口地址与模型名称",
  },
];

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  mode: "system",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-6.2-sol",
  maxIterations: 12,
};

export function isCustomModelConfigured(config: ModelConfig): boolean {
  return Boolean(
    config.apiKey.trim() && config.baseUrl.trim() && config.model.trim()
  );
}

export function getResolvedModelMode(config: ModelConfig): ModelConfigMode {
  if (config.mode === "custom") return "custom";
  if (config.mode === "system") return "system";
  return isCustomModelConfigured(config) ? "custom" : "system";
}

export function isEffectiveModelReady(
  config: ModelConfig,
  systemModel?: SystemModelPublicInfo | null
): boolean {
  const mode = getResolvedModelMode(config);
  if (mode === "custom") {
    return isCustomModelConfigured(config);
  }
  return Boolean(systemModel?.available);
}
