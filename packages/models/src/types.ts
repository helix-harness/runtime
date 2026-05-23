import type { ModelAdapter } from "@helix/core";

// ─── Model Config ────────────────────────────────────────────────────────────

export interface ModelConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  /** Max tokens for the response. Defaults to 8192. */
  maxTokens?: number;
}

// ─── Registry Types ───────────────────────────────────────────────────────────

export interface ModelProviderFactory {
  create(config: ModelConfig): ModelAdapter;
}

export interface ModelRegistration {
  provider: string;
  model: string;
  tags: string[];
}
