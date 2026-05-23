import type { ModelAdapter } from "@helix/core";
import type { ModelConfig, ModelProviderFactory, ModelRegistration } from "./types";

// ─── ModelRegistry ────────────────────────────────────────────────────────────

/**
 * Registry for model providers and model metadata.
 * Providers are registered with a factory, models are registered with tags.
 * Tags allow selecting a model by capability rather than by exact name.
 *
 * @example
 * registry.registerProvider("openai-compatible", { create: (cfg) => new OpenAICompatibleAdapter(cfg) })
 * registry.registerModel("openai-compatible", "gpt-4o", ["reasoning", "fast"])
 *
 * const model = registry.resolve("openai-compatible", "gpt-4o", { apiKey: "..." })
 * const fastModel = registry.resolveByTag("fast", { apiKey: "..." })
 */
export class ModelRegistry {
  private factories = new Map<string, ModelProviderFactory>();
  private modelMeta = new Map<string, ModelRegistration>();
  private tagIndex = new Map<string, Set<string>>();

  registerProvider(provider: string, factory: ModelProviderFactory): void {
    this.factories.set(provider, factory);
  }

  registerModel(provider: string, model: string, tags: string[] = []): void {
    const key = `${provider}/${model}`;
    this.modelMeta.set(key, { provider, model, tags });

    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }
  }

  getFactory(provider: string): ModelProviderFactory | undefined {
    return this.factories.get(provider);
  }

  getRegistration(provider: string, model: string): ModelRegistration | undefined {
    return this.modelMeta.get(`${provider}/${model}`);
  }

  findByTag(tag: string): Array<{ provider: string; model: string }> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return [];
    return [...keys].map((key) => {
      const [provider, ...rest] = key.split("/");
      return { provider: provider!, model: rest.join("/") };
    });
  }

  resolve(provider: string, model: string, config: ModelConfig): ModelAdapter {
    const factory = this.factories.get(provider);
    if (!factory) {
      throw new Error(
        `[helix/models] Unknown provider: "${provider}". ` +
          `Did you forget to call register${capitalize(provider)}()?`
      );
    }
    return factory.create({ model, ...config });
  }

  resolveByTag(tag: string, config: ModelConfig): ModelAdapter {
    const matches = this.findByTag(tag);
    if (matches.length === 0) {
      throw new Error(
        `[helix/models] No model found with tag: "${tag}". ` +
          `Available tags: ${this.allTags().join(", ")}`
      );
    }
    const { provider, model } = matches[0]!;
    return this.resolve(provider, model, config);
  }

  allTags(): string[] {
    return [...this.tagIndex.keys()];
  }

  allModels(): ModelRegistration[] {
    return [...this.modelMeta.values()];
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const registry = new ModelRegistry();
