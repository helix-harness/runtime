import type { ToolDef } from "@helix/core";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[helix/runtime] ToolRegistry: overwriting tool "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDef[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  clear(): void {
    this.tools.clear();
  }
}
