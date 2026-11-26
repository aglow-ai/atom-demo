import type { ModelConfig } from "../types";
import { anthropicNativeProvider } from "./anthropic-native";
import { geminiNativeProvider } from "./gemini-native";
import { openaiCompatibleProvider } from "./openai-compatible";
import { openaiResponsesProvider } from "./openai-responses";
import type { ModelProvider } from "./types";

export * from "./types";

/**
 * Resolve the optimal native provider implementation for a given ModelConfig.
 * - OpenAI -> Native Responses API (/v1/responses)
 * - Google Gemini -> Native Gemini API (/v1beta/models/{model}:streamGenerateContent)
 * - Anthropic -> Native Messages API (/v1/messages)
 * - DeepSeek / OpenRouter / Custom -> Chat Completions API (/v1/chat/completions)
 */
export function resolveModelProvider(config: ModelConfig): ModelProvider {
  const lowerUrl = (config.baseUrl || "").trim().toLowerCase();

  // Explicit endpoint overrides for custom base URLs
  if (lowerUrl.endsWith("/responses")) {
    return openaiResponsesProvider;
  }
  if (lowerUrl.endsWith("/messages")) {
    return anthropicNativeProvider;
  }
  if (lowerUrl.endsWith("/chat/completions")) {
    return openaiCompatibleProvider;
  }

  switch (config.provider) {
    case "openai":
      return openaiResponsesProvider;
    case "gemini":
      return geminiNativeProvider;
    case "anthropic":
      return anthropicNativeProvider;
    case "deepseek":
    case "openrouter":
      return openaiCompatibleProvider;
    case "custom":
    default: {
      if (lowerUrl.includes("api.openai.com")) return openaiResponsesProvider;
      if (lowerUrl.includes("generativelanguage.googleapis.com")) {
        return geminiNativeProvider;
      }
      if (lowerUrl.includes("api.anthropic.com")) {
        return anthropicNativeProvider;
      }
      return openaiCompatibleProvider;
    }
  }
}
