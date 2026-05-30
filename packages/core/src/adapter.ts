import type { AgentMessage } from "./message";
import type { ToolDef } from "./tool";

// ─── ThinkingLevel ────────────────────────────────────────────────────────────

/**
 * Controls extended thinking / reasoning budget for models that support it.
 * - "off":    No extended thinking (default).
 * - "minimal" .. "xhigh": Progressively larger token budgets for reasoning.
 *
 * Currently supported by: Anthropic Claude 3.7+, Claude 3.5 Sonnet (some versions).
 * Ignored by adapters whose model does not support extended thinking.
 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

/** Maps ThinkingLevel to approximate token budgets. Adapters may use these. */
export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  off: 0,
  minimal: 1_000,
  low: 5_000,
  medium: 10_000,
  high: 20_000,
  xhigh: 32_000,
};

// ─── ModelChunk ───────────────────────────────────────────────────────────────

/**
 * A single chunk emitted by ModelAdapter.stream().
 *
 * - text_delta:      A fragment of the assistant's text response.
 * - thinking_delta:  A fragment of extended thinking / reasoning output.
 *                    Emitted when thinkingLevel is not "off". UI only — the
 *                    runtime loop does not process thinking content.
 * - tool_call_delta: Incremental JSON fragment for a tool call's arguments.
 *                    UI only — the runtime loop waits for the complete tool_call.
 * - tool_call:       A complete, fully-parsed tool call ready for execution.
 * - done:            Signals end of stream for this turn.
 */
export type ModelChunk =
  | { type: "text_delta"; value: string }
  | { type: "thinking_delta"; value: string }
  | {
      type: "tool_call_delta";
      toolCallId: string;
      name?: string;
      argsDelta: string;
    }
  | {
      type: "tool_call";
      toolCallId: string;
      name: string;
      args: unknown;
    }
  | { type: "done" };

// ─── StreamOpts ───────────────────────────────────────────────────────────────

export interface StreamOpts {
  tools?: ToolDef[];
  signal?: AbortSignal;
  /**
   * System prompt to send to the LLM.
   * Passed as a top-level parameter (not part of messages) for providers that support it.
   * Adapters should place this before conversation messages when building the request.
   */
  systemPrompt?: string;
  /**
   * Extended thinking level. Adapters that don't support it should ignore this.
   * @default "off"
   */
  thinkingLevel?: ThinkingLevel;
}

// ─── ModelAdapter ─────────────────────────────────────────────────────────────

/**
 * The contract between @helix/runtime and any LLM provider.
 *
 * Chunk order per turn:
 *   1. Zero or more thinking_delta (if thinkingLevel != "off" and model supports it)
 *   2. Zero or more text_delta / tool_call_delta (interleaved)
 *   3. Zero or more tool_call (one per tool the LLM wants to invoke)
 *   4. Exactly one done
 *
 * AbortSignal must be respected — stop yielding and return when aborted.
 */
export interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: StreamOpts
  ): AsyncIterable<ModelChunk>;
}
