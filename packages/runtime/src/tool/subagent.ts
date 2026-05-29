import type { ToolDef, AgentMessage, ContentPart } from "@helix/core";
import { getContentText } from "@helix/core";
import type { AgentEvent } from "../event";

export interface SubagentToolOpts {
  /** Tool name used by the parent LLM to invoke this sub-agent. */
  name: string;
  /** Description shown to the parent LLM. Be specific about what to delegate. */
  description: string;
  /** The Agent instance to delegate to. */
  agent: SubagentInterface;
  /**
   * JSON Schema for tool parameters.
   * Defaults to a single required "task" string field.
   */
  parameters?: Record<string, unknown>;
  /**
   * Called for every event emitted by the sub-agent.
   * Forward to parent subscribers to observe the full execution tree.
   *
   * @example
   * onEvent: (e) => parentAgent.emit(e)  // bubble up sub-agent events
   */
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Minimal interface required from an Agent to act as a sub-agent.
 * Matches Agent class API — no special setup needed.
 */
export interface SubagentInterface {
  prompt(input: string | ContentPart[], opts?: { signal?: AbortSignal }): Promise<void>;
  subscribe(handler: (e: AgentEvent) => void): () => void;
  getMessages(): AgentMessage[];
  clearMessages(): void;
}

/**
 * Wrap an Agent as a ToolDef so a parent agent can delegate tasks to it.
 *
 * Execution flow:
 *   parent LLM emits tool_call
 *     → ToolExecutor calls subagent.execute()
 *     → sub-agent runs its own agentLoop (with its own model + tools)
 *     → last assistant message returned as tool result to parent LLM
 *
 * @example
 * const reviewer = new Agent({
 *   model: getModel({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey }),
 *   systemPrompt: "You are a code review expert.",
 *   tools: [readFileTool],
 * })
 *
 * const manager = new Agent({
 *   model: getModel({ model: "gpt-4o", apiKey }),
 *   tools: [
 *     createSubagentTool({
 *       name: "code_review",
 *       description: "Delegate code review to a specialist agent.",
 *       agent: reviewer,
 *       onEvent: (e) => { if (e.type === "message_update") process.stdout.write(e.delta) },
 *     }),
 *   ],
 * })
 *
 * await manager.prompt("Review the quality of src/utils.ts")
 */
export function createSubagentTool(opts: SubagentToolOpts): ToolDef {
  const parameters = opts.parameters ?? {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task or question to delegate to the sub-agent.",
      },
    },
    required: ["task"],
  };

  return {
    name: opts.name,
    description: opts.description,
    parameters,
    execute: async (args: unknown) => {
      const { task } = args as { task: string };

      if (!task || typeof task !== "string") {
        throw new Error(
          `[subagent:${opts.name}] "task" argument must be a non-empty string`
        );
      }

      // Wire up event forwarding before prompting
      let unsub: (() => void) | undefined;
      if (opts.onEvent) {
        unsub = opts.agent.subscribe(opts.onEvent);
      }

      try {
        await opts.agent.prompt(task);
      } finally {
        unsub?.();
      }

      // Return the last assistant text response as the tool result
      const messages = opts.agent.getMessages();
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant" && getContentText(m.content).trim().length > 0);

      return {
        status: "completed",
        result: lastAssistant ? getContentText(lastAssistant.content) : "(sub-agent produced no text response)",
        messageCount: messages.length,
      };
    },
  };
}
