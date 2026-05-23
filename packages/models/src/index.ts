// ─── Public API ───────────────────────────────────────────────────────────────
// Zero side effects on import. Call registerOpenAI() / registerAnthropic()
// explicitly before using getModel().

export { getModel, getModelByTag } from "./getModel";
export { registry, ModelRegistry } from "./registry";

// Provider registration (call these in your app entry point)
export { registerOpenAI, registerOpenAICompatible } from "./providers/openai";
export { registerAnthropic } from "./providers/anthropic";

// Adapters (for constructing adapters directly without the registry)
export { OpenAICompatibleAdapter } from "./adapters/openai-compatible";
export { AnthropicAdapter } from "./adapters/anthropic";

// Types
export type { ModelConfig, ModelProviderFactory, ModelRegistration } from "./types";
