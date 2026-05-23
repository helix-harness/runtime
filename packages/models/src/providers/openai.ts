import { registry } from "../registry";
import { OpenAICompatibleAdapter } from "../adapters/openai-compatible";

// ─── registerOpenAI ───────────────────────────────────────────────────────────

/**
 * Register the OpenAI provider and its default models.
 * Must be called before using getModel("openai", ...) or getModelByTag(...).
 *
 * @example
 * import { registerOpenAI, getModel } from "@helix/models"
 * registerOpenAI()
 * const model = getModel("openai", "gpt-4o", { apiKey: process.env.OPENAI_KEY! })
 */
export function registerOpenAI(): void {
  registry.registerProvider("openai", {
    create: (config) =>
      new OpenAICompatibleAdapter({
        ...config,
        baseURL: config.baseURL ?? "https://api.openai.com/v1",
      }),
  });

  registry.registerModel("openai", "gpt-4o",       ["reasoning", "fast", "vision"]);
  registry.registerModel("openai", "gpt-4o-mini",  ["fast", "cheap"]);
  registry.registerModel("openai", "o3",            ["reasoning", "code"]);
  registry.registerModel("openai", "o4-mini",       ["fast-reasoning", "code"]);
}

// ─── registerOpenAICompatible ─────────────────────────────────────────────────

/**
 * Register any OpenAI-compatible provider (Groq, Ollama, Together, etc.)
 *
 * @example
 * registerOpenAICompatible("groq", "https://api.groq.com/openai/v1", [
 *   { model: "llama-3.3-70b-versatile", tags: ["fast", "cheap"] },
 * ])
 */
export function registerOpenAICompatible(
  provider: string,
  baseURL: string,
  models: Array<{ model: string; tags?: string[] }>
): void {
  registry.registerProvider(provider, {
    create: (config) =>
      new OpenAICompatibleAdapter({ ...config, baseURL }),
  });

  for (const { model, tags = [] } of models) {
    registry.registerModel(provider, model, tags);
  }
}
