import { registry } from "../registry";
import { AnthropicAdapter } from "../adapters/anthropic";

// ─── registerAnthropic ────────────────────────────────────────────────────────

/**
 * Register the Anthropic provider and its default models.
 * Must be called before using getModel("anthropic", ...).
 *
 * @example
 * import { registerAnthropic, getModel } from "@helix/models"
 * registerAnthropic()
 * const model = getModel("anthropic", "claude-sonnet-4-20250514", { apiKey: process.env.ANTHROPIC_KEY! })
 */
export function registerAnthropic(): void {
  registry.registerProvider("anthropic", {
    create: (config) => new AnthropicAdapter(config),
  });

  registry.registerModel("anthropic", "claude-opus-4-20250514",   ["reasoning", "powerful"]);
  registry.registerModel("anthropic", "claude-sonnet-4-20250514", ["reasoning", "fast", "code"]);
  registry.registerModel("anthropic", "claude-haiku-4-5-20251001", ["fast", "cheap"]);
}
