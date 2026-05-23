import type {
  AgentContext,
  AgentMessage,
  ModelAdapter,
  ToolDef,
  ToolResult,
} from "@helix/core";
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
import { ToolRegistry } from "../tool";
import { ToolExecutor } from "../tool";

const MAX_TURNS = 20;


export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  sink: EventSink
): Promise<AgentMessage[]> {
  const { model, signal } = config;

  // Build tool registry from context
  const registry = new ToolRegistry();
  if (context.tools?.length) registry.registerAll(context.tools);
  const executor = new ToolExecutor();

  // Accumulated messages for this run (prompts + new assistant/tool messages)
  const newMessages: AgentMessage[] = [];

  emitAgentStart(sink);

  try {
    // ── Transform context (compaction / RAG injection) ──────────────────────
    let contextMessages = [...context.messages, ...prompts];

    if (config.transformContext) {
      const tokensBefore = estimateTokens(contextMessages);
      contextMessages = await config.transformContext(contextMessages, signal);
      const tokensAfter = estimateTokens(contextMessages);
      if (tokensAfter < tokensBefore) {
        emitContextCompacted(sink, tokensBefore, tokensAfter);
      }
    }

    // ── Convert to LLM format ───────────────────────────────────────────────
    let llmMessages = config.convertToLlm
      ? config.convertToLlm(contextMessages)
      : defaultConvertToLlm(contextMessages);

    // ── Agent loop ──────────────────────────────────────────────────────────
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) break;

      emitTurnStart(sink);

      // Emit user messages on first turn
      if (turn === 0) {
        for (const msg of prompts) {
          emitMessageStart(sink, msg);
          emitMessageEnd(sink, msg);
        }
      }

      // ── Stream from LLM ─────────────────────────────────────────────────
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

      // ── No tool calls → loop ends ────────────────────────────────────────
      if (!assistantMsg.toolCalls?.length) {
        emitTurnEnd(sink, assistantMsg, []);

        const shouldStop = config.shouldStopAfterTurn
          ? await config.shouldStopAfterTurn({ message: assistantMsg, toolResults: [] })
          : true; // Default: stop when no tool calls

        if (shouldStop) break;
        continue;
      }

      // ── Execute tool calls ───────────────────────────────────────────────
      const callsToRun = assistantMsg.toolCalls ?? [];

      // Apply beforeToolCall hook (filter blocked calls)
      const allowedCalls: typeof callsToRun = [];
      for (const call of callsToRun) {
        if (config.beforeToolCall) {
          const decision = await config.beforeToolCall({ name: call.name, args: call.args });
          if (decision === "block") {
            // Inject a blocked result so LLM knows
            newMessages.push({
              role: "toolResult",
              content: `Tool "${call.name}" was blocked by policy.`,
              timestamp: Date.now(),
              toolCallId: call.toolCallId,
              isError: true,
            });
            continue;
          }
        }
        allowedCalls.push(call);
      }

      const toolResults = await executor.executeAll(
        allowedCalls,
        registry,
        sink,
        signal
      );

      // afterToolCall hook
      if (config.afterToolCall) {
        for (const result of toolResults) {
          await config.afterToolCall({
            name: allowedCalls.find((c) => c.toolCallId === result.toolCallId)?.name ?? "",
            result: result.content,
            isError: result.isError,
          });
        }
      }

      // Append tool result messages
      const toolResultMessages: AgentMessage[] = toolResults.map((r) => ({
        role: "toolResult" as const,
        content: r.content,
        timestamp: Date.now(),
        toolCallId: r.toolCallId,
        isError: r.isError,
      }));

      newMessages.push(...toolResultMessages);

      emitTurnEnd(sink, assistantMsg, toolResults);

      // shouldStopAfterTurn hook
      if (config.shouldStopAfterTurn) {
        const shouldStop = await config.shouldStopAfterTurn({
          message: assistantMsg,
          toolResults,
        });
        if (shouldStop) break;
      }

      // Build next turn's messages
      llmMessages = config.convertToLlm
        ? config.convertToLlm([...contextMessages, ...newMessages])
        : defaultConvertToLlm([...contextMessages, ...newMessages]);
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

/**
 * Default message filter: only pass standard roles to LLM.
 * Custom/UI-only message types are dropped.
 */
function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((m) =>
    ["user", "assistant", "toolResult", "system"].includes(m.role)
  );
}

/**
 * Rough token estimator (chars / 4).
 * Good enough for compaction threshold checks.
 * Replace with a proper tokenizer if needed.
 */
export function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
}
