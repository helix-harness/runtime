import { registry } from "./registry";
import type { ModelAdapter } from "@helix/core";
import type { ModelConfig } from "./registry";

export function getModel(provider: string, model: string, config?: Partial<ModelConfig>): ModelAdapter | undefined;
export function getModel(tag: string, config?: Partial<ModelConfig>): ModelAdapter | undefined;
export function getModel(
  providerOrTag: string,
  modelOrConfig?: string | Partial<ModelConfig>,
  config?: Partial<ModelConfig>
): ModelAdapter | undefined {
  if (typeof modelOrConfig === "string") {
    const factory = registry.getFactory(providerOrTag);
    if (!factory) return undefined;
    return factory.create({ model: modelOrConfig, ...config } as ModelConfig);
  } else {
    const matches = registry.findByTag(providerOrTag);
    if (matches.length === 0) return undefined;
    const match = matches[0]!;
    const factory = registry.getFactory(match.provider);
    if (!factory) return undefined;
    return factory.create({ model: match.model, ...modelOrConfig } as ModelConfig);
  }
}
