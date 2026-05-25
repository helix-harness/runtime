import type { AgentContext, AgentMessage, ToolResult } from "@helix/core";
import type { AgentLoopConfig } from "./index";
import type { EventSink } from "../event";
import {
  emitAgentStart,
  emitAgentEnd,
  emitTurnStart,
  emitTurnEnd,
  emitMessageStart,
  emitMessageUpdate,
  emitMessageEnd,
  emitContextCompacted,
  emitError,
} from "../event";
import { ToolRegistry, ToolExecutor } from "../tool";

const MAX_TURNS = 20;

// ─── runAgentLoop ─────────────────────────────────────────────────────────────

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  sink: EventSink
): Promise<AgentMessage[]> {
  const { model, signal } = config;

  const registry = new ToolRegistry();
  if (context.tools?.length) registry.registerAll(context.tools);
  const executor = new ToolExecutor();

  // All messages produced during this run (returned to caller for accumulation)
  const newMessages: AgentMessage[] = [];

  emitAgentStart(sink);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) break;

      emitTurnStart(sink);

      // ── Emit user messages on first turn only ──────────────────────────────
      if (turn === 0) {
        for (const msg of prompts) {
          emitMessageStart(sink, msg);
          emitMessageEnd(sink, msg);
        }
      }

      // ── Build current turn's full message list ─────────────────────────────
      // Re-built every turn so transformContext always sees the latest messages.
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
          emitContextCompacted(sink, tokensBefore, tokensAfter);
        }
      }

      // convertToLlm: filter out UI-only / custom message types
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

      emitMessageStart(sink, assistantMsg);

      for await (const chunk of model.stream(llmMessages, {
        tools: registry.list(),
        signal,
      })) {
        if (signal?.aborted) break;

        switch (chunk.type) {
          case "text_delta":
            assistantMsg.content += chunk.value;
            emitMessageUpdate(sink, assistantMsg, chunk.value);
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

      emitMessageEnd(sink, assistantMsg);
      newMessages.push(assistantMsg);

      // ── No tool calls → check stop condition ──────────────────────────────
      if (!assistantMsg.toolCalls?.length) {
        emitTurnEnd(sink, assistantMsg, []);

        const shouldStop = config.shouldStopAfterTurn
          ? await config.shouldStopAfterTurn({ message: assistantMsg, toolResults: [] })
          : true; // Default: stop when LLM produces no tool calls

        if (shouldStop) break;
        continue;
      }

      // ── Apply beforeToolCall + collect blocked results ─────────────────────
      const callsToRun = assistantMsg.toolCalls ?? [];
      const allowedCalls: typeof callsToRun = [];
      const blockedResults: ToolResult[] = [];

      for (const call of callsToRun) {
        if (config.beforeToolCall) {
          const decision = await config.beforeToolCall({ name: call.name, args: call.args });
          if (decision === "block") {
            const blockedResult: ToolResult = {
              toolCallId: call.toolCallId,
              content: `Tool "${call.name}" was blocked by policy.`,
              isError: true,
              durationMs: 0,
            };
            blockedResults.push(blockedResult);

            // Notify afterToolCall for blocked calls too
            if (config.afterToolCall) {
              await config.afterToolCall({
                name: call.name,
                result: blockedResult.content,
                isError: true,
              });
            }
            continue;
          }
        }
        allowedCalls.push(call);
      }

      // ── Execute allowed tool calls ─────────────────────────────────────────
      const executedResults = await executor.executeAll(
        allowedCalls,
        registry,
        sink,
        signal
      );

      // afterToolCall hook for executed calls
      if (config.afterToolCall) {
        for (const result of executedResults) {
          await config.afterToolCall({
            name: allowedCalls.find((c) => c.toolCallId === result.toolCallId)?.name ?? "",
            result: result.content,
            isError: result.isError,
          });
        }
      }

      // Merge blocked + executed results, preserving original tool call order
      const allResults: ToolResult[] = callsToRun.map((call) => {
        return (
          executedResults.find((r) => r.toolCallId === call.toolCallId) ??
          blockedResults.find((r) => r.toolCallId === call.toolCallId)!
        );
      });

      // Append tool result messages
      const toolResultMessages: AgentMessage[] = allResults.map((r) => ({
        role: "toolResult" as const,
        content: r.content,
        timestamp: Date.now(),
        toolCallId: r.toolCallId,
        isError: r.isError,
      }));

      newMessages.push(...toolResultMessages);
      emitTurnEnd(sink, assistantMsg, allResults);

      // ── shouldStopAfterTurn hook ───────────────────────────────────────────
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
    emitError(sink, error, true);
    emitAgentEnd(sink, newMessages);
    throw err;
  }

  emitAgentEnd(sink, newMessages);
  return newMessages;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((m) =>
    ["user", "assistant", "toolResult", "system"].includes(m.role)
  );
}

/**
 * Rough token estimator (chars / 4).
 * Sufficient for compaction threshold checks.
 * Replace with a real tokenizer if precision is needed.
 */
export function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
}
