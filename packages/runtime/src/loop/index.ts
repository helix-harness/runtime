import type { AgentContext, AgentMessage, ModelAdapter, ToolResult, StreamOpts, ModelChunk, ThinkingLevel } from "@helix/core";
import type { AgentEvent } from "../event/types";
import { runAgentLoop } from "./run";

// ─── StreamFn ─────────────────────────────────────────────────────────────────

/**
 * Optional override for the LLM stream call.
 * When provided, replaces model.stream() in every turn of the loop.
 *
 * Use cases:
 * - Proxy all LLM requests through your own backend (hide API keys)
 * - Add request logging / auditing
 * - Inject custom headers or auth tokens
 * - Rate limiting / request queuing
 *
 * @example
 * const agent = new Agent({
 *   model: getModel({ model: "gpt-4o", apiKey: "..." }),
 *   streamFn: async function*(messages, opts) {
 *     // Forward to your backend proxy
 *     const res = await fetch("/api/llm", {
 *       method: "POST",
 *       body: JSON.stringify({ messages, opts }),
 *     })
 *     for await (const chunk of parseSSE(res.body)) yield chunk
 *   },
 * })
 */
export type StreamFn = (
  messages: AgentMessage[],
  opts: StreamOpts
) => AsyncIterable<ModelChunk>;

// ─── AgentLoopConfig ──────────────────────────────────────────────────────────

export interface AgentLoopConfig {
  /** LLM adapter to use for this loop. */
  model: ModelAdapter;

  /** AbortSignal for cancellation. */
  signal?: AbortSignal;

  /**
   * Override the LLM stream call entirely.
   * When set, model.stream() is NOT called — streamFn is called instead.
   * Receives the same (messages, opts) that would have gone to model.stream().
   */
  streamFn?: StreamFn;

  /**
   * Extended thinking / reasoning level.
   * Passed as opts.thinkingLevel to model.stream() / streamFn on every turn.
   * Models that don't support extended thinking ignore this.
   * @default "off"
   */
  thinkingLevel?: ThinkingLevel;

  /**
   * Transform messages before each LLM call.
   * Called once per turn, before convertToLlm.
   */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;

  /**
   * Filter/convert AgentMessage[] to the subset the LLM should receive.
   * Defaults to keeping: user, assistant, toolResult, system.
   */
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[];

  /** Called before each tool execution. Return "block" to prevent it. */
  beforeToolCall?: (ctx: {
    name: string;
    args: unknown;
  }) => Promise<"allow" | "block"> | "allow" | "block";

  /**
   * Called after each tool execution, BEFORE tool_execution_end is emitted.
   * Matches pi's ordering: hook fires → end event emitted.
   */
  afterToolCall?: (ctx: {
    name: string;
    result: unknown;
    isError: boolean;
  }) => Promise<void> | void;

  /**
   * Called after each turn. Return true to stop the loop early.
   * Default: stop when LLM produces no tool calls.
   */
  shouldStopAfterTurn?: (ctx: {
    message: AgentMessage;
    toolResults: ToolResult[];
  }) => Promise<boolean> | boolean;
}

// ─── agentLoop ────────────────────────────────────────────────────────────────

export async function* agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  yield* runAgentLoop(prompts, context, config);
}

export async function* agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  yield* runAgentLoop([], context, config);
}
