export type ToolDef<TArgs = unknown> = {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: TArgs) => Promise<ToolResult | { terminate: true }>
  executionMode?: "parallel" | "sequential"
}

export type ToolResult = {
  toolCallId: string
  content: string
  isError: boolean
  durationMs: number
}
