import type { AgentContext, AgentMessage, ToolResult } from "@helix/core";
import type { EventSink } from "../event";
import { noopSink } from "../event";
import { runAgentLoop } from "./run";

// ─── AgentLoopConfig ──────────────────────────────────────────────────────────

export interface AgentLoopConfig {
  /** LLM adapter to use for this loop. */
  model: import("@helix/core").ModelAdapter;

  /** AbortSignal for cancellation. Passed through to model.stream() and tool execution. */
  signal?: AbortSignal;

  /**
   * Transform messages before each LLM call.
   * Called once per turn, before convertToLlm.
   * Use for: context compaction, RAG injection, dynamic system prompt injection.
   */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;

  /**
   * Filter/convert AgentMessage[] to the subset the LLM should receive.
   * Called every turn after transformContext.
   * Defaults to keeping: user, assistant, toolResult, system.
   * Override to filter out UI-only or custom message types.
   */
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[];

  /**
   * Called before each tool execution.
   * Return "block" to prevent execution — a blocked error result is sent to the LLM instead.
   */
  beforeToolCall?: (ctx: {
    name: string;
    args: unknown;
  }) => Promise<"allow" | "block"> | "allow" | "block";

  /**
   * Called after each tool execution (including errors and blocked calls).
   */
  afterToolCall?: (ctx: {
    name: string;
    result: unknown;
    isError: boolean;
  }) => Promise<void> | void;

  /**
   * Called after each turn completes.
   * Return true to stop the loop early (before MAX_TURNS).
   * Default behaviour: stop when the LLM produces no tool calls.
   */
  shouldStopAfterTurn?: (ctx: {
    message: AgentMessage;
    toolResults: ToolResult[];
  }) => Promise<boolean> | boolean;
}

// ─── agentLoop ────────────────────────────────────────────────────────────────

/**
 * Core stateless agent loop.
 *
 * Drives the LLM → tool_call → execute → result → LLM cycle.
 * All state lives in `context`; nothing is held inside the loop.
 * All behaviour is observable via the `sink` callback.
 *
 * @param prompts   New messages for this run (typically one user message).
 * @param context   Current agent context: systemPrompt, message history, tools.
 * @param config    Model, hooks, and loop options.
 * @param sink      Called synchronously on every AgentEvent.
 * @returns         All new messages produced: assistant messages + tool results.
 *
 * @example
 * const context: AgentContext = { systemPrompt: "...", messages: [], tools: [] }
 *
 * const newMsgs = await agentLoop(
 *   [{ role: "user", content: "Hello", timestamp: Date.now() }],
 *   context,
 *   { model },
 *   (e) => console.log(e.type)
 * )
 *
 * context.messages.push(...newMsgs)
 */
export async function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  sink: EventSink = noopSink
): Promise<AgentMessage[]> {
  return runAgentLoop(prompts, context, config, sink);
}

/**
 * Continue the loop from the current context without adding new user messages.
 * Useful for retrying after an error or resuming an interrupted run.
 */
export async function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  sink: EventSink = noopSink
): Promise<AgentMessage[]> {
  return runAgentLoop([], context, config, sink);
}
