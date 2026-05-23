import type { AgentEvent } from "./types";
import type { AgentMessage, ToolResult } from "@helix/core";

/**
 * A simple push-based event sink.
 * agentLoop writes to it; Agent.subscribe() reads from it.
 */
export type EventSink = (event: AgentEvent) => void;

export const noopSink: EventSink = () => {};

export function emitAgentStart(sink: EventSink): void {
  sink({ type: "agent_start" });
}

export function emitAgentEnd(sink: EventSink, messages: AgentMessage[]): void {
  sink({ type: "agent_end", messages });
}

export function emitTurnStart(sink: EventSink): void {
  sink({ type: "turn_start" });
}

export function emitTurnEnd(
  sink: EventSink,
  message: AgentMessage,
  toolResults: ToolResult[]
): void {
  sink({ type: "turn_end", message, toolResults });
}

export function emitMessageStart(sink: EventSink, message: AgentMessage): void {
  sink({ type: "message_start", message });
}

export function emitMessageUpdate(
  sink: EventSink,
  message: AgentMessage,
  delta: string
): void {
  sink({ type: "message_update", message, delta });
}

export function emitMessageEnd(sink: EventSink, message: AgentMessage): void {
  sink({ type: "message_end", message });
}

export function emitToolExecutionStart(
  sink: EventSink,
  toolCallId: string,
  name: string,
  args: unknown
): void {
  sink({ type: "tool_execution_start", toolCallId, name, args });
}

export function emitToolExecutionEnd(
  sink: EventSink,
  toolCallId: string,
  name: string,
  result: unknown,
  isError: boolean,
  durationMs: number
): void {
  sink({ type: "tool_execution_end", toolCallId, name, result, isError, durationMs });
}

export function emitContextCompacted(
  sink: EventSink,
  tokensBefore: number,
  tokensAfter: number
): void {
  sink({ type: "context_compacted", tokensBefore, tokensAfter });
}

export function emitError(sink: EventSink, error: Error, fatal: boolean): void {
  sink({ type: "error", error, fatal });
}
