import type { AgentMessage, ToolResult } from "@helix/core";

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResult[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: string }
  | { type: "message_end"; message: AgentMessage }
  | { type: "thinking_update"; delta: string }
  | { type: "tool_execution_start"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partial: unknown }
  | { type: "tool_execution_end"; toolCallId: string; name: string; result: unknown; isError: boolean; durationMs: number }
  | { type: "context_compacted"; tokensBefore: number; tokensAfter: number }
  | { type: "error"; error: Error; fatal: boolean };
