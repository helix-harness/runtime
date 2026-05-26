/**
 * Shared utilities for playground cases
 */

import { getModel } from "@helix/models";
import type { ModelAdapter } from "@helix/core";

export interface ModelOptions {
  provider?: "openai-compatible" | "anthropic-compatible";
  model?: string;
}

/**
 * Get model adapter from environment variables.
 * Falls back to "gpt-4o" if LLM_MODEL_ID is not set.
 */
export function createModel(options: ModelOptions = {}): ModelAdapter {
  if (!process.env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY environment variable is not set");
  }

  return getModel({
    provider: options.provider ?? "openai-compatible",
    model: options.model ?? process.env.LLM_MODEL_ID ?? "gpt-4o",
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
  });
}

/**
 * Check if required environment variables are set.
 */
export function checkEnv(): boolean {
  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    return false;
  }
  return true;
}

/**
 * Check if OpenAI-specific environment variables are set.
 */
export function checkOpenAI(): boolean {
  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    return false;
  }
  return true;
}

/**
 * Check if Anthropic-specific environment variables are set.
 */
export function checkAnthropic(): boolean {
  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    return false;
  }
  return true;
}