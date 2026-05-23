import type { AgentMessage } from "./message"
import type { ToolDef } from "./tool"

export type ModelChunk =
  | { type: "text_delta"; value: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done" }

export interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk>
}
