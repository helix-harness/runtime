export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "system" | string
  content: string
  timestamp: number
  toolCallId?: string
}