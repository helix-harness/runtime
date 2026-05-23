export { registry, getModel } from "./types";
export type { ModelConfig, ModelProviderFactory, ModelRegistration } from "./types";

export { OpenAICompatibleAdapter, type OpenAICompatibleAdapterOptions } from "./adapters/openai-compatible";

// Provider factory for OpenAI-compatible APIs
import { OpenAICompatibleAdapter } from "./adapters/openai-compatible";
import { registry } from "./types";

// Register default provider
registry.registerProvider("openai-compatible", {
  create(config) {
    return new OpenAICompatibleAdapter({
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
    });
  },
});

// Default model metadata
registry.registerModel("openai-compatible", "gpt-4o", ["reasoning", "fast"]);
registry.registerModel("openai-compatible", "gpt-4o-mini", ["fast-reasoning", "cheap-chat"]);
registry.registerModel("openai-compatible", "o3", ["reasoning", "code-specialist"]);
registry.registerModel("openai-compatible", "o4-mini", ["fast-reasoning", "code-specialist"]);
