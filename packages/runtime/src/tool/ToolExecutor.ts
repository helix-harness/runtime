import type { ToolResult, ToolCallRef } from "@helix/core";
import type { ToolRegistry } from "./ToolRegistry";
import type { EventSink } from "../event";
import { emitToolExecutionStart, emitToolExecutionEnd } from "../event/emitters";

export class ToolExecutor {
  /**
   * Execute a single tool call.
   * Never throws — errors are captured into ToolResult.isError.
   */
  async execute(
    call: ToolCallRef,
    registry: ToolRegistry,
    sink: EventSink,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    emitToolExecutionStart(sink, call.toolCallId, call.name, call.args);
    const start = Date.now();

    const tool = registry.get(call.name);
    if (!tool) {
      const durationMs = Date.now() - start;
      const content = `Tool not found: "${call.name}"`;
      emitToolExecutionEnd(sink, call.toolCallId, call.name, content, true, durationMs);
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }

    if (signal?.aborted) {
      const durationMs = Date.now() - start;
      const content = "Tool execution aborted";
      emitToolExecutionEnd(sink, call.toolCallId, call.name, content, true, durationMs);
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }

    try {
      const output = await tool.execute(call.args);
      const content = typeof output === "string" ? output : JSON.stringify(output);
      const durationMs = Date.now() - start;
      emitToolExecutionEnd(sink, call.toolCallId, call.name, output, false, durationMs);
      return { toolCallId: call.toolCallId, content, isError: false, durationMs };
    } catch (err) {
      const content = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - start;
      emitToolExecutionEnd(sink, call.toolCallId, call.name, content, true, durationMs);
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }
  }

  /**
   * Execute multiple tool calls.
   * Defaults to parallel. Falls back to sequential if any tool declares executionMode: "sequential".
   */
  async executeAll(
    calls: ToolCallRef[],
    registry: ToolRegistry,
    sink: EventSink,
    signal?: AbortSignal,
    batchMode: "parallel" | "sequential" = "parallel"
  ): Promise<ToolResult[]> {
    if (calls.length === 0) return [];

    const hasSequential = calls.some((c) => registry.get(c.name)?.executionMode === "sequential");
    const mode = hasSequential ? "sequential" : batchMode;

    if (mode === "parallel") {
      return Promise.all(calls.map((call) => this.execute(call, registry, sink, signal)));
    }

    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.execute(call, registry, sink, signal));
    }
    return results;
  }
}
