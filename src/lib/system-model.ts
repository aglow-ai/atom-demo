import {
  MODEL_PRESETS,
  type ModelConfig,
  type ModelProviderId,
  type SystemModelPublicInfo,
} from "./types";

const VALID_PROVIDERS = new Set<ModelProviderId>([
  "openai",
  "gemini",
  "anthropic",
  "deepseek",
  "openrouter",
  "custom",
]);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function resolveProviderId(raw: string | undefined): ModelProviderId {
  const cleaned = (raw || "").trim().toLowerCase() as ModelProviderId;
  if (VALID_PROVIDERS.has(cleaned)) return cleaned;
  return "openai";
}

export function getBillingRates() {
  return {
    inputTokensPerCredit: parsePositiveInt(
      process.env.SYSTEM_MODEL_TOKENS_PER_CREDIT_INPUT,
      4000
    ),
    cachedInputTokensPerCredit: parsePositiveInt(
      process.env.SYSTEM_MODEL_TOKENS_PER_CREDIT_CACHED_INPUT,
      40000
    ),
    cacheWriteTokensPerCredit: parsePositiveInt(
      process.env.SYSTEM_MODEL_TOKENS_PER_CREDIT_CACHE_WRITE,
      3200
    ),
    outputTokensPerCredit: parsePositiveInt(
      process.env.SYSTEM_MODEL_TOKENS_PER_CREDIT_OUTPUT,
      1000
    ),
    minCreditsPerRun: parsePositiveInt(
      process.env.SYSTEM_MODEL_MIN_CREDITS_PER_RUN,
      1
    ),
    initialCredits: 100,
  };
}

export function getSystemModelServerConfig(): {
  config: ModelConfig | null;
  publicInfo: SystemModelPublicInfo;
} {
  const provider = resolveProviderId(process.env.SYSTEM_MODEL_PROVIDER);
  const preset =
    MODEL_PRESETS.find((p) => p.id === provider) ?? MODEL_PRESETS[0];

  const apiKey = (process.env.SYSTEM_MODEL_API_KEY || "").trim();
  const baseUrl = (
    process.env.SYSTEM_MODEL_BASE_URL ||
    (provider === "custom" ? "" : preset.baseUrl)
  ).trim();
  const model = (
    process.env.SYSTEM_MODEL_NAME ||
    process.env.SYSTEM_MODEL ||
    (provider === "custom" ? "" : preset.defaultModel)
  ).trim();
  const maxIterations = Math.min(
    Math.max(parsePositiveInt(process.env.SYSTEM_MODEL_MAX_ITERATIONS, 12), 4),
    20
  );

  const rates = getBillingRates();
  const available = Boolean(apiKey && baseUrl && model);

  const publicInfo: SystemModelPublicInfo = {
    available,
    provider,
    model,
    maxIterations,
    ...rates,
  };

  if (!available) {
    return { config: null, publicInfo };
  }

  return {
    config: {
      mode: "system",
      provider,
      baseUrl,
      apiKey,
      model,
      maxIterations,
    },
    publicInfo,
  };
}

export function getSystemModelPublicInfo(): SystemModelPublicInfo {
  return getSystemModelServerConfig().publicInfo;
}

/**
 * Convert total input/cached/cache-write/output tokens consumed during a system-model run into integer credits.
 * Cached input hits are billed at a separate discounted rate (default 0.1x of regular input).
 * Always charges at least `minCreditsPerRun` (default 1) whenever tokens were consumed.
 */
export function calculateCreditsFromTokens(usage: {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
}): number {
  const safeInput = Math.max(0, Number(usage.inputTokens) || 0);
  const safeCached = Math.max(0, Number(usage.cachedInputTokens) || 0);
  const safeCacheWrite = Math.max(0, Number(usage.cacheWriteTokens) || 0);
  const safeOutput = Math.max(0, Number(usage.outputTokens) || 0);
  if (
    safeInput === 0 &&
    safeCached === 0 &&
    safeCacheWrite === 0 &&
    safeOutput === 0
  ) {
    return 0;
  }

  const {
    inputTokensPerCredit,
    cachedInputTokensPerCredit,
    cacheWriteTokensPerCredit,
    outputTokensPerCredit,
    minCreditsPerRun,
  } = getBillingRates();

  const rawCredits =
    safeInput / inputTokensPerCredit +
    safeCached / cachedInputTokensPerCredit +
    safeCacheWrite / cacheWriteTokensPerCredit +
    safeOutput / outputTokensPerCredit;

  return Math.max(minCreditsPerRun, Math.ceil(rawCredits));
}
