import type { ModelAdapter } from "@helix/core";
import { registry } from "./registry";
import type { ModelConfig } from "./types";

// ─── getModel ─────────────────────────────────────────────────────────────────

/**
 * Resolve a model adapter by provider + model name.
 *
 * @throws if provider is not registered
 *
 * @example
 * const model = getModel("openai-compatible", "gpt-4o", { apiKey: "..." })
 */
export function getModel(
  provider: string,
  model: string,
  config: ModelConfig
): ModelAdapter {
  return registry.resolve(provider, model, config);
}

// ─── getModelByTag ────────────────────────────────────────────────────────────

/**
 * Resolve a model adapter by capability tag.
 * Selects the first registered model with the given tag.
 * Useful when you don't want to hard-code a specific model name in your agent.
 *
 * @throws if no model is registered with the given tag
 *
 * @example
 * const model = getModelByTag("fast", { apiKey: "..." })
 * const model = getModelByTag("code-specialist", { apiKey: "..." })
 */
export function getModelByTag(tag: string, config: ModelConfig): ModelAdapter {
  return registry.resolveByTag(tag, config);
}
