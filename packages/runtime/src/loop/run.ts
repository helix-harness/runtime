import type { AgentContext, AgentMessage, ToolResult } from "@helix/core";
import type { AgentEvent } from "../event";
import type { AgentLoopConfig } from "./index";
import { ToolRegistry } from "../tool";
import { ToolExecutor } from "../tool";

const MAX_TURNS = 20;

export async function* runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  const { model, signal } = config;

  // streamFn overrides model.stream() when provided
  const streamFn = config.streamFn ?? model.stream.bind(model);
  const thinkingLevel = config.thinkingLevel ?? "off";

  const registry = new ToolRegistry();
  if (context.tools?.length) registry.registerAll(context.tools);
  const executor = new ToolExecutor();

  const newMessages: AgentMessage[] = [];

  yield { type: "agent_start" };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) break;

      yield { type: "turn_start" };

      if (turn === 0) {
        for (const msg of prompts) {
          yield { type: "message_start", message: msg };
          yield { type: "message_end", message: msg };
        }
      }

      // Build full message list for this turn
      let turnMessages: AgentMessage[] = [
        ...context.messages,
        ...prompts,
        ...newMessages,
      ];

      if (config.transformContext) {
        const tokensBefore = estimateTokens(turnMessages);
        turnMessages = await config.transformContext(turnMessages, signal);
        const tokensAfter = estimateTokens(turnMessages);
        if (tokensAfter < tokensBefore) {
          yield { type: "context_compacted", tokensBefore, tokensAfter };
        }
      }

      const llmMessages = config.convertToLlm
        ? config.convertToLlm(turnMessages)
        : defaultConvertToLlm(turnMessages);

      // ── Stream from LLM (via streamFn or model.stream) ───────────────────
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolCalls: [],
      };

      yield { type: "message_start", message: assistantMsg };

      for await (const chunk of streamFn(llmMessages, {
        tools: registry.list(),
        signal,
        thinkingLevel,
      })) {
        if (signal?.aborted) break;

        switch (chunk.type) {
          case "text_delta":
            assistantMsg.content += chunk.value;
            yield { type: "message_update", message: assistantMsg, delta: chunk.value };
            break;

          case "thinking_delta":
            // Forward to subscribers for UI display; not added to content
            yield { type: "thinking_update", delta: chunk.value };
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

      // No tool calls → check stop
      if (!assistantMsg.toolCalls?.length) {
        yield { type: "turn_end", message: assistantMsg, toolResults: [] };

        const shouldStop = config.shouldStopAfterTurn
          ? await config.shouldStopAfterTurn({ message: assistantMsg, toolResults: [] })
          : true;

        if (shouldStop) break;
        continue;
      }

      // ── beforeToolCall: filter blocked ───────────────────────────────────
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

            // BUG FIX #1: afterToolCall before tool_execution_end
            yield { type: "tool_execution_start", toolCallId: call.toolCallId, name: call.name, args: call.args };
            if (config.afterToolCall) {
              await config.afterToolCall({ name: call.name, result: blocked.content, isError: true });
            }
            yield { type: "tool_execution_end", toolCallId: call.toolCallId, name: call.name, result: blocked.content, isError: true, durationMs: 0 };
            continue;
          }
        }
        allowedCalls.push(call);
      }

      // ── Execute tool calls (yields tool_execution_start) ─────────────────
      const executeGen = executor.executeAll(allowedCalls, registry, signal);
      let next = await executeGen.next();
      while (!next.done) {
        yield next.value;
        next = await executeGen.next();
      }
      const executeResults = next.value;

      // BUG FIX #1: afterToolCall before tool_execution_end for each result
      for (const er of executeResults) {
        const callName = allowedCalls.find((c) => c.toolCallId === er.toolResult.toolCallId)?.name ?? "";

        if (config.afterToolCall) {
          await config.afterToolCall({
            name: callName,
            result: er.toolResult.content,
            isError: er.toolResult.isError,
          });
        }

        yield {
          type: "tool_execution_end",
          toolCallId: er.toolResult.toolCallId,
          name: callName,
          result: er.rawOutput ?? er.toolResult.content,
          isError: er.toolResult.isError,
          durationMs: er.toolResult.durationMs,
        };
      }

      // BUG FIX #2: terminate only when ALL non-error results have terminate:true
      const finalizedResults = executeResults.filter((er) => !er.toolResult.isError);
      const allTerminate =
        finalizedResults.length > 0 &&
        finalizedResults.every(
          (er) =>
            er.rawOutput !== null &&
            typeof er.rawOutput === "object" &&
            (er.rawOutput as Record<string, unknown>)["terminate"] === true
        );

      const executedToolResults = executeResults.map((er) => er.toolResult);
      const allResults: ToolResult[] = callsToRun.map(
        (call) =>
          executedToolResults.find((r) => r.toolCallId === call.toolCallId) ??
          blockedResults.find((r) => r.toolCallId === call.toolCallId)!
      );

      const toolResultMessages: AgentMessage[] = allResults.map((r) => ({
        role: "toolResult" as const,
        content: r.content,
        timestamp: Date.now(),
        toolCallId: r.toolCallId,
        isError: r.isError,
      }));

      newMessages.push(...toolResultMessages);
      yield { type: "turn_end", message: assistantMsg, toolResults: allResults };

      if (allTerminate) break;

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

function defaultConvertToLlm(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((m) =>
    ["user", "assistant", "toolResult", "system"].includes(m.role)
  );
}

export function estimateTokens(messages: AgentMessage[]): number {
  return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
}
