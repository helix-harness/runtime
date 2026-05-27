import type { AgentContext, AgentMessage, ModelAdapter, ToolResult } from "@helix/core";
import type { AgentEvent } from "../event/types";
import { runAgentLoop } from "./run";

// ─── AgentLoopConfig ──────────────────────────────────────────────────────────

export interface AgentLoopConfig {
  /** LLM adapter to use for this loop. */
  model: ModelAdapter;

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
   */
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[];

  /**
   * Called before each tool execution.
   * Return "block" to prevent execution.
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
   * Return true to stop the loop early.
   * Default: stop when LLM produces no tool calls.
   */
  shouldStopAfterTurn?: (ctx: {
    message: AgentMessage;
    toolResults: ToolResult[];
  }) => Promise<boolean> | boolean;
}

// ─── agentLoop ────────────────────────────────────────────────────────────────

/**
 * Core stateless agent loop. Returns an AsyncGenerator of AgentEvent.
 *
 * Drives the LLM → tool_call → execute → result → LLM cycle.
 * All state lives in `context`; nothing is held inside the loop.
 *
 * Collect produced messages from agent_end:
 *   if (event.type === "agent_end") context.messages.push(...event.messages)
 *
 * @example
 * const context: AgentContext = { systemPrompt: "...", messages: [], tools: [] }
 *
 * for await (const event of agentLoop([userMsg], context, { model })) {
 *   if (event.type === "message_update") process.stdout.write(event.delta)
 *   if (event.type === "agent_end") context.messages.push(...event.messages)
 * }
 */
export async function* agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  yield* runAgentLoop(prompts, context, config);
}

/**
 * Continue the loop from the current context without adding new user messages.
 * Useful for retrying after an error or resuming an interrupted run.
 *
 * @example
 * for await (const event of agentLoopContinue(context, { model })) {
 *   if (event.type === "message_update") process.stdout.write(event.delta)
 * }
 */
export async function* agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  yield* runAgentLoop([], context, config);
}
