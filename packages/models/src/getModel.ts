import type { ModelAdapter } from "@helix/core";
import { OpenAICompatibleAdapter } from "./adapters/openai";
import { AnthropicAdapter } from "./adapters/anthropic";

// ─── ModelParams ──────────────────────────────────────────────────────────────

export interface ModelParams {
  /**
   * Which wire protocol to use.
   *
   * - "openai-compatible" — OpenAI Chat Completions API format.
   *   Works with: OpenAI, Groq, Ollama, Together, Fireworks, any local server.
   *
   * - "anthropic" — Anthropic Messages API format.
   *   Works with: Anthropic directly, or any proxy that speaks the Anthropic protocol.
   *
   * @default "openai-compatible"
   */
  provider?: "openai-compatible" | "anthropic";

  /** Model ID to use. e.g. "gpt-4o", "claude-sonnet-4-20250514" */
  model: string;

  /** API key for the provider. */
  apiKey: string;

  /**
   * Base URL for the API endpoint.
   * Defaults to the official endpoint for the selected provider.
   *
   * Override this to use a proxy, local server, or compatible third-party API.
   *
   * @example "https://api.groq.com/openai/v1"   // Groq (openai-compatible)
   * @example "http://localhost:11434/v1"          // Ollama (openai-compatible)
   * @example "https://my-proxy.com/anthropic"     // Custom Anthropic proxy
   */
  baseURL?: string;

  /** Max tokens for the response. Defaults to 8192. */
  maxTokens?: number;
}

// ─── getModel ─────────────────────────────────────────────────────────────────

/**
 * Create a ModelAdapter by specifying provider, model, and credentials.
 * No registration or setup needed — just call and use.
 *
 * @example OpenAI
 * const model = getModel({ model: "gpt-4o", apiKey: "sk-..." })
 *
 * @example Anthropic
 * const model = getModel({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-ant-..." })
 *
 * @example Groq (OpenAI-compatible)
 * const model = getModel({ model: "llama-3.3-70b-versatile", apiKey: "gsk_...", baseURL: "https://api.groq.com/openai/v1" })
 *
 * @example Ollama (local, no key needed)
 * const model = getModel({ model: "llama3.2", apiKey: "ollama", baseURL: "http://localhost:11434/v1" })
 *
 * @example Anthropic via custom proxy
 * const model = getModel({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "...", baseURL: "https://my-proxy.com" })
 */
export function getModel(params: ModelParams): ModelAdapter {
  const provider = params.provider ?? "openai-compatible";

  switch (provider) {
    case "openai-compatible":
      return new OpenAICompatibleAdapter({
        apiKey: params.apiKey,
        model: params.model,
        baseURL: params.baseURL,
        maxTokens: params.maxTokens,
      });

    case "anthropic":
      return new AnthropicAdapter({
        apiKey: params.apiKey,
        model: params.model,
        baseURL: params.baseURL,
        maxTokens: params.maxTokens,
      });

    default:
      throw new Error(
        `[helix/models] Unknown provider: "${provider}". ` +
          `Valid values: "openai-compatible", "anthropic".`
      );
  }
}
