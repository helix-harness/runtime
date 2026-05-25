export interface ToolDef<TArgs = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;        // JSON Schema
  execute: (args: TArgs) => Promise<unknown>;
  executionMode?: "parallel" | "sequential";  // default: parallel
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  durationMs: number;
}
