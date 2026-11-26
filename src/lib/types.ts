export type ModelProviderId =
  | "openai"
  | "gemini"
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

export interface ModelConfig {
  provider: ModelProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxIterations: number;
  temperature: number;
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
  role: "user" | "assistant";
  content: string;
  steps?: ReActStep[];
  filesChanged?: string[];
  snapshotId?: string;
  status?: "streaming" | "done" | "error" | "aborted";
  error?: string;
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
    }
  | { type: "error"; message: string };

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    suggestedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    keyPlaceholder: "sk-...",
    docsHint: "支持 OpenAI 官方 API Key",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ],
    keyPlaceholder: "AIza...",
    docsHint: "使用 Google AI Studio OpenAI 兼容端点",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    keyPlaceholder: "sk-...",
    docsHint: "使用 DeepSeek OpenAI 兼容接口",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    suggestedModels: [
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
      "openai/gpt-4.1",
    ],
    keyPlaceholder: "sk-or-...",
    docsHint: "通过 OpenRouter 调用任意主流模型",
  },
  {
    id: "custom",
    name: "自定义接口",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    suggestedModels: [],
    keyPlaceholder: "输入 API Key",
    docsHint: "支持自定义接口地址与模型名称",
  },
];

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1",
  maxIterations: 12,
  temperature: 0.2,
};
