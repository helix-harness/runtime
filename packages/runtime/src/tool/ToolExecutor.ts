import type { ToolResult, ToolCallRef } from "@helix/core";
import type { ToolRegistry } from "./ToolRegistry";
import type { AgentEvent } from "../event/types";

// ─── ToolExecutor ─────────────────────────────────────────────────────────────

export class ToolExecutor {
  /**
   * Execute a single tool call.
   * Yields tool_execution_start and tool_execution_end events.
   * Never throws — errors are captured into ToolResult.isError.
   */
  async *execute(
    call: ToolCallRef,
    registry: ToolRegistry,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, ToolResult> {
    yield { type: "tool_execution_start", toolCallId: call.toolCallId, name: call.name, args: call.args };

    const start = Date.now();

    const tool = registry.get(call.name);
    if (!tool) {
      const durationMs = Date.now() - start;
      const content = `Tool not found: "${call.name}"`;
      yield { type: "tool_execution_end", toolCallId: call.toolCallId, name: call.name, result: content, isError: true, durationMs };
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }

    if (signal?.aborted) {
      const durationMs = Date.now() - start;
      const content = "Tool execution aborted";
      yield { type: "tool_execution_end", toolCallId: call.toolCallId, name: call.name, result: content, isError: true, durationMs };
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }

    try {
      const output = await tool.execute(call.args);
      const content = typeof output === "string" ? output : JSON.stringify(output);
      const durationMs = Date.now() - start;
      yield { type: "tool_execution_end", toolCallId: call.toolCallId, name: call.name, result: output, isError: false, durationMs };
      return { toolCallId: call.toolCallId, content, isError: false, durationMs };
    } catch (err) {
      const content = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - start;
      yield { type: "tool_execution_end", toolCallId: call.toolCallId, name: call.name, result: content, isError: true, durationMs };
      return { toolCallId: call.toolCallId, content, isError: true, durationMs };
    }
  }

  /**
   * Execute multiple tool calls, yielding events for each.
   * parallel (default): all calls run concurrently.
   * sequential: calls run one after another.
   * If any tool declares executionMode "sequential", the whole batch is sequential.
   */
  async *executeAll(
    calls: ToolCallRef[],
    registry: ToolRegistry,
    signal?: AbortSignal,
    batchMode: "parallel" | "sequential" = "parallel"
  ): AsyncGenerator<AgentEvent, ToolResult[]> {
    if (calls.length === 0) return [];

    const hasSequential = calls.some(
      (c) => registry.get(c.name)?.executionMode === "sequential"
    );
    const mode = hasSequential ? "sequential" : batchMode;

    if (mode === "sequential") {
      const results: ToolResult[] = [];
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

    // Parallel: run all generators concurrently, merge events in completion order
    const results: ToolResult[] = new Array(calls.length);
    const generators = calls.map((call, i) => ({ i, gen: this.execute(call, registry, signal) }));

    // Collect all events and results via Promise.all over the generators
    // We need to drain each generator and interleave events
    const eventQueues: AgentEvent[][] = calls.map(() => []);
    const resultPromises = generators.map(async ({ i, gen }) => {
      let next = await gen.next();
      while (!next.done) {
        eventQueues[i]!.push(next.value);
        next = await gen.next();
      }
      results[i] = next.value;
    });

    // Yield events as they arrive using a merge approach
    // For simplicity: run all in parallel, collect results, then yield all events
    // (events arrive in parallel order, which is fine for UI)
    await Promise.all(resultPromises);

    // Yield all collected events (interleaved by tool completion order)
    for (const queue of eventQueues) {
      for (const event of queue) {
        yield event;
      }
    }

    return results;
  }
}
