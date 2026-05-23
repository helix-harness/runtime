import type { AgentMessage } from "./message"
import type { ToolDef } from "./tool"

export interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDef[]
}
