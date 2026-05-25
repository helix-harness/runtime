import type { AgentMessage } from "./message";
import type { ToolDef } from "./tool";

/**
 * The stateless runtime context passed into agentLoop.
 * Holds all state needed to drive the loop: system prompt, message history, tools.
 * Callers are responsible for persisting and updating this between calls.
 */
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: ToolDef[];
}
