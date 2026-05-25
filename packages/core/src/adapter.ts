import type { AgentMessage } from "./message";
import type { ToolDef } from "./tool";

// ─── ModelChunk ───────────────────────────────────────────────────────────────

/**
 * A single chunk emitted by ModelAdapter.stream().
 *
 * - text_delta:      A fragment of the assistant's text response (streaming token).
 * - tool_call_delta: Incremental JSON fragment for a tool call's arguments.
 *                    Intended for UIs that want to show streaming tool args.
 *                    The runtime loop does NOT process this — it waits for tool_call.
 * - tool_call:       A complete, fully-parsed tool call ready for execution.
 *                    Emitted once per tool call after all argument fragments arrive.
 * - done:            Signals the end of the stream for this turn.
 */
export type ModelChunk =
  | { type: "text_delta"; value: string }
  | {
      type: "tool_call_delta";
      toolCallId: string;
      /** Tool name. May be undefined for the very first delta before the name is known. */
      name?: string;
      /** Incremental JSON string fragment (not yet valid JSON). UI use only. */
      argsDelta: string;
    }
  | {
      type: "tool_call";
      toolCallId: string;
      name: string;
      /** Fully parsed args object. Ready for ToolExecutor. */
      args: unknown;
    }
  | { type: "done" };

// ─── ModelAdapter ─────────────────────────────────────────────────────────────

/**
 * The contract between @helix/runtime and any LLM provider.
 *
 * Implementors must yield ModelChunk values in this order per turn:
 *   1. Zero or more text_delta / tool_call_delta (interleaved, optional)
 *   2. Zero or more tool_call (one per tool the LLM wants to invoke)
 *   3. Exactly one done
 *
 * AbortSignal must be respected: when aborted, the generator should
 * stop yielding and return (or throw DOMException with name "AbortError").
 */
export interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: {
      tools?: ToolDef[];
      signal?: AbortSignal;
    }
  ): AsyncIterable<ModelChunk>;
}
