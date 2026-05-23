import type { ModelAdapter } from "@helix/core";

export interface ModelConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export interface ModelProviderFactory {
  create(config: ModelConfig): ModelAdapter;
}

export interface ModelRegistration {
  provider: string;
  model: string;
  tags: string[];
}

class ModelRegistry {
  private factories: Map<string, ModelProviderFactory> = new Map();
  private modelMeta: Map<string, ModelRegistration> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  registerProvider(provider: string, factory: ModelProviderFactory) {
    this.factories.set(provider, factory);
  }

  registerModel(provider: string, model: string, tags: string[] = []) {
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

  findByTag(tag: string): Array<{ provider: string; model: string }> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return [];
    return [...keys].map(key => {
      const parts = key.split("/");
      return { provider: parts[0]!, model: parts[1]! };
    });
  }
}

export const registry = new ModelRegistry();
