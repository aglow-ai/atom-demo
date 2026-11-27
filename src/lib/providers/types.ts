import type { ModelConfig } from "../types";

export interface ProviderToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  argumentsStr: string;
}

export interface ProviderTokenUsage {
  /** Non-cached regular input tokens */
  inputTokens: number;
  /** Prompt cache hit (read) input tokens */
  cachedInputTokens: number;
  /** Prompt cache creation (write) input tokens */
  cacheWriteTokens: number;
  /** Output tokens (including reasoning/thoughts) */
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderTurnResult {
  content: string;
  reasoning: string;
  toolCalls: ProviderToolCall[];
  usage?: ProviderTokenUsage;
}

export interface ProviderToolResultInput {
  callId: string;
  toolName: string;
  output: string;
  ok: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  model?: string;
  reply?: string;
  status?: number;
  error?: string;
}

export interface ProviderSessionInit {
  config: ModelConfig;
  systemPrompt: string;
  workspaceContext: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userPrompt: string;
  tools: ProviderToolSpec[];
}

export interface ProviderSession {
  runTurn(params: {
    signal: AbortSignal;
    onTextDelta: (delta: string) => void;
  }): Promise<ProviderTurnResult>;

  appendToolResults(results: ProviderToolResultInput[]): void;

  appendUserFollowUp(content: string): void;
}

export interface ModelProvider {
  readonly id: string;
  testConnection(config: ModelConfig): Promise<ProviderTestResult>;
  createSession(init: ProviderSessionInit): ProviderSession;
}

export async function parseJsonErrorMessage(res: Response): Promise<string> {
  const errText = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(errText);
    return String(
      parsed?.error?.message ||
        parsed?.message ||
        (typeof parsed?.error === "string" ? parsed.error : errText)
    );
  } catch {
    return errText;
  }
}
