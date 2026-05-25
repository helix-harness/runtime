/**
 * A tool call initiated by the assistant.
 * Stored inside an assistant message when the LLM requests tool execution.
 */
export interface ToolCallRef {
  toolCallId: string;
  name: string;
  args: unknown;
}

export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "system" | (string & {});
  content: string;
  timestamp: number;

  /**
   * Present on assistant messages when the LLM requested tool execution.
   * One assistant message can contain multiple tool calls (parallel tool use).
   */
  toolCalls?: ToolCallRef[];

  /**
   * Present on toolResult messages.
   * Links this result back to the tool call that produced it.
   */
  toolCallId?: string;

  /**
   * Present on toolResult messages.
   * Marks whether the tool execution failed.
   * Anthropic uses this to set is_error on the tool_result block.
   */
  isError?: boolean;
}
