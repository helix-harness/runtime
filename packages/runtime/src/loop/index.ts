import type { AgentContext, AgentMessage, ModelAdapter, ToolResult } from "@helix/core";
import type { EventSink } from "../event";
import { noopSink } from "../event";
import { runAgentLoop } from "./run";

export interface AgentLoopConfig {
  /** LLM adapter to use for this loop. */
  model: ModelAdapter;

  /** AbortSignal for cancellation. */
  signal?: AbortSignal;

  /**
   * Transform messages before passing to LLM.
   * Use for context compaction, RAG injection, or dynamic system prompt.
   * Executed before convertToLlm on every turn.
   */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;

  /**
   * Convert AgentMessage[] to the subset the LLM should see.
   * Use to filter out UI-only or custom message types.
   * Defaults to keeping: user, assistant, toolResult, system.
   */
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[];

  /**
   * Called before each tool execution.
   * Return "block" to prevent the tool from running.
   */
  beforeToolCall?: (ctx: {
    name: string;
    args: unknown;
  }) => Promise<"allow" | "block"> | "allow" | "block";

  /**
   * Called after each tool execution completes (including errors).
   */
  afterToolCall?: (ctx: {
    name: string;
    result: unknown;
    isError: boolean;
  }) => Promise<void> | void;

  /**
   * Called after each turn. Return true to stop the loop early.
   * If not provided, the loop stops when the LLM produces no tool calls.
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
 * All state is passed in via `context`; none is held internally.
 * All behaviour is observable via the `sink` callback.
 *
 * @param prompts   New messages to send this turn (typically one user message).
 * @param context   Current agent context (systemPrompt, messages, tools).
 * @param config    Model, hooks, and loop configuration.
 * @param sink      Event sink — called synchronously for every AgentEvent.
 * @returns         New messages produced during this run (assistant + toolResults).
 *
 * @example
 * const context: AgentContext = { systemPrompt: "...", messages: [], tools: [] }
 * const newMessages = await agentLoop(
 *   [{ role: "user", content: "hello", timestamp: Date.now() }],
 *   context,
 *   { model },
 *   (event) => console.log(event.type)
 * )
 * context.messages.push(...newMessages)
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
 * Useful for retrying after an error or resuming a paused session.
 */
export async function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  sink: EventSink = noopSink
): Promise<AgentMessage[]> {
  return runAgentLoop([], context, config, sink);
}
