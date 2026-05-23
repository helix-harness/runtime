import type { ToolResult } from "@helix/core";
import type { ToolCallRef } from "@helix/core";
import type { ToolRegistry } from "./ToolRegistry";
import type { EventSink } from "../event/emitters";
import {
  emitToolExecutionStart,
  emitToolExecutionEnd,
} from "../event/emitters";


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
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        content: `Tool not found: "${call.name}"`,
        isError: true,
        durationMs: Date.now() - start,
      };
      emitToolExecutionEnd(sink, call.toolCallId, call.name, result.content, true, result.durationMs);
      return result;
    }

    if (signal?.aborted) {
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        content: "Tool execution aborted",
        isError: true,
        durationMs: Date.now() - start,
      };
      emitToolExecutionEnd(sink, call.toolCallId, call.name, result.content, true, result.durationMs);
      return result;
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
   *
   * Mode "parallel" (default): all calls run concurrently via Promise.all.
   * Mode "sequential": calls run one after another.
   *
   * If any individual tool has executionMode "sequential",
   * the entire batch falls back to sequential.
   */
  async executeAll(
    calls: ToolCallRef[],
    registry: ToolRegistry,
    sink: EventSink,
    signal?: AbortSignal,
    batchMode: "parallel" | "sequential" = "parallel"
  ): Promise<ToolResult[]> {
    if (calls.length === 0) return [];

    // If any tool in the batch requires sequential, downgrade the whole batch
    const hasSequential = calls.some((c) => {
      const tool = registry.get(c.name);
      return tool?.executionMode === "sequential";
    });

    const mode = hasSequential ? "sequential" : batchMode;

    if (mode === "parallel") {
      return Promise.all(
        calls.map((call) => this.execute(call, registry, sink, signal))
      );
    }

    // Sequential
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.execute(call, registry, sink, signal));
    }
    return results;
  }
}
