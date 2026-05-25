import type { AgentMessage, ToolResult } from "@helix/core";

/**
 * All events emitted by agentLoop during a single agent.prompt() call.
 *
 * Sequence per turn (no tool calls):
 *   agent_start → turn_start → message_start → message_update* → message_end → turn_end → agent_end
 *
 * Sequence per turn (with tool calls):
 *   agent_start → turn_start
 *     → message_start(assistant) → message_update* → message_end
 *     → tool_execution_start → tool_execution_end   (one per tool, parallel or sequential)
 *     → turn_end
 *   → turn_start  (LLM continues after tool results)
 *     → message_start → message_update* → message_end
 *     → turn_end
 *   → agent_end
 */
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResult[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: string }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partial: unknown }
  | { type: "tool_execution_end"; toolCallId: string; name: string; result: unknown; isError: boolean; durationMs: number }
  | { type: "context_compacted"; tokensBefore: number; tokensAfter: number }
  | { type: "error"; error: Error; fatal: boolean };
