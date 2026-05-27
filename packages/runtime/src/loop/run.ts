import type { AgentContext, AgentMessage, ToolCallRef, ToolDef, ToolResult } from "@helix/core";
import type { AgentEvent } from "../event";
import type { AgentLoopConfig } from "./index";
import { ToolRegistry } from "../tool";

const MAX_TURNS = 20;

// ─── runAgentLoop ─────────────────────────────────────────────────────────────

export async function* runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  const { model, signal } = config;

  const registry = new ToolRegistry();
  if (context.tools?.length) registry.registerAll(context.tools);

  // All messages produced during this run (returned via agent_end event)
  const newMessages: AgentMessage[] = [];

  yield { type: "agent_start" };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) break;

      yield { type: "turn_start" };

      // ── Emit user messages on first turn only ──────────────────────────────
      if (turn === 0) {
        for (const msg of prompts) {
          yield { type: "message_start", message: msg };
          yield { type: "message_end", message: msg };
        }
      }

      // ── Build current turn's full message list ─────────────────────────────
      // Re-built every turn so transformContext always sees the latest state.
      let turnMessages: AgentMessage[] = [
        ...context.messages,
        ...prompts,
        ...newMessages,
      ];

      // transformContext: compaction, RAG injection, etc.
      if (config.transformContext) {
        const tokensBefore = estimateTokens(turnMessages);
        turnMessages = await config.transformContext(turnMessages, signal);
        const tokensAfter = estimateTokens(turnMessages);
        if (tokensAfter < tokensBefore) {
          yield { type: "context_compacted", tokensBefore, tokensAfter };
        }
      }

      // convertToLlm: filter UI-only / custom message types
      const llmMessages = config.convertToLlm
        ? config.convertToLlm(turnMessages)
        : defaultConvertToLlm(turnMessages);

      // ── Stream from LLM ────────────────────────────────────────────────────
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolCalls: [],
      };

      yield { type: "message_start", message: assistantMsg };

      for await (const chunk of model.stream(llmMessages, {
        tools: registry.list(),
        signal,
      })) {
        if (signal?.aborted) break;

        switch (chunk.type) {
          case "text_delta":
            assistantMsg.content += chunk.value;
            yield { type: "message_update", message: assistantMsg, delta: chunk.value };
            break;

          case "tool_call":
            assistantMsg.toolCalls!.push({
              toolCallId: chunk.toolCallId,
              name: chunk.name,
              args: chunk.args,
            });
            break;

          case "done":
            break;
        }
      }

      yield { type: "message_end", message: assistantMsg };
      newMessages.push(assistantMsg);

      // ── No tool calls → check stop condition ──────────────────────────────
      if (!assistantMsg.toolCalls?.length) {
        yield { type: "turn_end", message: assistantMsg, toolResults: [] };

        const shouldStop = config.shouldStopAfterTurn
          ? await config.shouldStopAfterTurn({ message: assistantMsg, toolResults: [] })
          : true;

        if (shouldStop) break;
        continue;
      }

      // ── beforeToolCall: filter blocked calls ───────────────────────────────
      const callsToRun = assistantMsg.toolCalls ?? [];
      const allowedCalls: typeof callsToRun = [];
      const blockedResults: ToolResult[] = [];

      for (const call of callsToRun) {
        if (config.beforeToolCall) {
          const decision = await config.beforeToolCall({ name: call.name, args: call.args });
          if (decision === "block") {
            const blocked: ToolResult = {
              toolCallId: call.toolCallId,
              content: `Tool "${call.name}" was blocked by policy.`,
              isError: true,
              durationMs: 0,
            };
            blockedResults.push(blocked);

            if (config.afterToolCall) {
              await config.afterToolCall({
                name: call.name,
                result: blocked.content,
                isError: true,
              });
            }
            continue;
          }
        }
        allowedCalls.push(call);
      }

      // ── Execute tool calls — yield events, call hooks in correct order ───────
      //
      // Correct order per turn (matches pi):
      //   tool_execution_start  (all, immediately)
      //   [tools run — parallel or sequential]
      //   afterToolCall hook          ← BEFORE tool_execution_end
      //   tool_execution_end
      //   toolResult messages
      //   turn_end
      //
      const executedResults: ToolResult[] = [];

      // Determine execution mode: sequential if any tool requires it
      const hasSequential = allowedCalls.some(
        (c) => registry.get(c.name)?.executionMode === "sequential"
      );
      const batchMode = hasSequential ? "sequential" : "parallel";

      if (batchMode === "parallel" && allowedCalls.length > 1) {
        // Emit all tool_execution_start events first
        for (const call of allowedCalls) {
          yield { type: "tool_execution_start", toolCallId: call.toolCallId, name: call.name, args: call.args };
        }

        // Run all tools concurrently
        const results = await Promise.all(
          allowedCalls.map((call) => executeToolCall(call, registry, signal))
        );

        // For each result: afterToolCall → tool_execution_end (in source order)
        for (const result of results) {
          const call = allowedCalls.find((c) => c.toolCallId === result.toolCallId)!;

          // Bug 2 fix: afterToolCall BEFORE tool_execution_end
          if (config.afterToolCall) {
            await config.afterToolCall({
              name: call.name,
              result: result.content,
              isError: result.isError,
            });
          }

          yield {
            type: "tool_execution_end",
            toolCallId: result.toolCallId,
            name: call.name,
            result: result.content,
            isError: result.isError,
            durationMs: result.durationMs,
          };

          executedResults.push(result);
        }
      } else {
        // Sequential: one at a time
        for (const call of allowedCalls) {
          yield { type: "tool_execution_start", toolCallId: call.toolCallId, name: call.name, args: call.args };

          const result = await executeToolCall(call, registry, signal);

          // Bug 2 fix: afterToolCall BEFORE tool_execution_end
          if (config.afterToolCall) {
            await config.afterToolCall({
              name: call.name,
              result: result.content,
              isError: result.isError,
            });
          }

          yield {
            type: "tool_execution_end",
            toolCallId: result.toolCallId,
            name: call.name,
            result: result.content,
            isError: result.isError,
            durationMs: result.durationMs,
          };

          executedResults.push(result);
        }
      }

      // Merge blocked + executed, preserving original tool call order
      const allResults: ToolResult[] = callsToRun.map(
        (call) =>
          executedResults.find((r) => r.toolCallId === call.toolCallId) ??
          blockedResults.find((r) => r.toolCallId === call.toolCallId)!
      );

      // Append tool result messages
      const toolResultMessages: AgentMessage[] = allResults.map((r) => ({
        role: "toolResult" as const,
        content: r.content,
        timestamp: Date.now(),
        toolCallId: r.toolCallId,
        isError: r.isError,
      }));

      newMessages.push(...toolResultMessages);
      yield { type: "turn_end", message: assistantMsg, toolResults: allResults };

      const allTerminate = allResults.length > 0 &&
        allResults.every((r) => (r as any).terminate === true);

      if (allTerminate) break;

      // shouldStopAfterTurn hook
      if (config.shouldStopAfterTurn) {
        const shouldStop = await config.shouldStopAfterTurn({
          message: assistantMsg,
          toolResults: allResults,
        });
        if (shouldStop) break;
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    yield { type: "error", error, fatal: true };
    yield { type: "agent_end", messages: newMessages };
    throw err;
  }

  yield { type: "agent_end", messages: newMessages };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((m) =>
    ["user", "assistant", "toolResult", "system"].includes(m.role)
  );
}

/**
 * Execute a single tool call. Never throws — errors are captured into ToolResult.
 * Used directly by runAgentLoop so we can interleave afterToolCall between
 * execution and tool_execution_end emission.
 */
async function executeToolCall(
  call: ToolCallRef,
  registry: ToolRegistry,
  signal?: AbortSignal
): Promise<ToolResult> {
  const start = Date.now();

  const tool = registry.get(call.name);
  if (!tool) {
    return {
      toolCallId: call.toolCallId,
      content: `Tool not found: "${call.name}"`,
      isError: true,
      durationMs: Date.now() - start,
    };
  }

  if (signal?.aborted) {
    return {
      toolCallId: call.toolCallId,
      content: "Tool execution aborted",
      isError: true,
      durationMs: Date.now() - start,
    };
  }

  try {
    const output = await tool.execute(call.args);
    const content = typeof output === "string" ? output : JSON.stringify(output);
    return {
      toolCallId: call.toolCallId,
      content,
      isError: false,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      toolCallId: call.toolCallId,
      content: err instanceof Error ? err.message : String(err),
      isError: true,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Rough token estimator (chars / 4).
 * Sufficient for compaction threshold checks.
 * Replace with a real tokenizer if precision is needed.
 */
export function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
}
