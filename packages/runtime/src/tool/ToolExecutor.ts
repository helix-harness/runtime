import type { ToolResult, ToolCallRef } from "@helix/core";
import type { ToolRegistry } from "./ToolRegistry";
import type { AgentEvent } from "../event/types";

// ─── ExecuteResult ────────────────────────────────────────────────────────────

/**
 * Internal result from a single tool execution.
 * Preserves rawOutput so run.ts can detect { terminate: true }.
 */
export interface ExecuteResult {
  toolResult: ToolResult;
  /** Raw value returned by tool.execute() — checked for { terminate: true }. */
  rawOutput: unknown;
}

// ─── ToolExecutor ─────────────────────────────────────────────────────────────

export class ToolExecutor {
  /**
   * Execute a single tool call.
   *
   * BUG FIX #1 (afterToolCall timing):
   * Yields ONLY tool_execution_start.
   * Does NOT yield tool_execution_end — that is the caller's responsibility,
   * so afterToolCall can run between execution and the end event (matching pi).
   *
   * Never throws — errors are captured into ExecuteResult.toolResult.isError.
   */
  async *execute(
    call: ToolCallRef,
    registry: ToolRegistry,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, ExecuteResult> {
    yield {
      type: "tool_execution_start",
      toolCallId: call.toolCallId,
      name: call.name,
      args: call.args,
    };

    const start = Date.now();

    const tool = registry.get(call.name);
    if (!tool) {
      return {
        toolResult: {
          toolCallId: call.toolCallId,
          content: `Tool not found: "${call.name}"`,
          isError: true,
          durationMs: Date.now() - start,
        },
        rawOutput: undefined,
      };
    }

    if (signal?.aborted) {
      return {
        toolResult: {
          toolCallId: call.toolCallId,
          content: "Tool execution aborted",
          isError: true,
          durationMs: Date.now() - start,
        },
        rawOutput: undefined,
      };
    }

    try {
      const rawOutput = await tool.execute(call.args);
      const content =
        typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
      return {
        toolResult: {
          toolCallId: call.toolCallId,
          content,
          isError: false,
          durationMs: Date.now() - start,
        },
        rawOutput,
      };
    } catch (err) {
      return {
        toolResult: {
          toolCallId: call.toolCallId,
          content: err instanceof Error ? err.message : String(err),
          isError: true,
          durationMs: Date.now() - start,
        },
        rawOutput: undefined,
      };
    }
  }

  /**
   * Execute multiple tool calls, yielding tool_execution_start events.
   * parallel (default) or sequential. Falls back to sequential if any tool
   * declares executionMode: "sequential".
   */
  async *executeAll(
    calls: ToolCallRef[],
    registry: ToolRegistry,
    signal?: AbortSignal,
    batchMode: "parallel" | "sequential" = "parallel"
  ): AsyncGenerator<AgentEvent, ExecuteResult[]> {
    if (calls.length === 0) return [];

    const hasSequential = calls.some(
      (c) => registry.get(c.name)?.executionMode === "sequential"
    );
    const mode = hasSequential ? "sequential" : batchMode;

    if (mode === "sequential") {
      const results: ExecuteResult[] = [];
      for (const call of calls) {
        const gen = this.execute(call, registry, signal);
        let next = await gen.next();
        while (!next.done) {
          yield next.value;
          next = await gen.next();
        }
        results.push(next.value);
      }
      return results;
    }

    // Parallel: run all concurrently, collect start events and results
    const startEvents: AgentEvent[] = [];
    const results: ExecuteResult[] = new Array(calls.length);

    await Promise.all(
      calls.map(async (call, i) => {
        const gen = this.execute(call, registry, signal);
        let next = await gen.next();
        while (!next.done) {
          startEvents.push(next.value);
          next = await gen.next();
        }
        results[i] = next.value;
      })
    );

    for (const event of startEvents) yield event;
    return results;
  }
}
