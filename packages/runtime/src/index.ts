// ─── Agent (stateful) ────────────────────────────────────────────────────────
export { Agent } from "./agent/agent";
export type { AgentOptions } from "./agent/agent";

// ─── agentLoop (stateless) ───────────────────────────────────────────────────
export { agentLoop, agentLoopContinue } from "./loop/index";
export type { AgentLoopConfig } from "./loop/index";

// ─── Tools ───────────────────────────────────────────────────────────────────
export { ToolRegistry } from "./tool/ToolRegistry";
export { ToolExecutor } from "./tool/ToolExecutor";

// ─── Events ──────────────────────────────────────────────────────────────────
export type { AgentEvent } from "./event/types";
export type { EventSink } from "./event/emitters";

// ─── Utils ───────────────────────────────────────────────────────────────────
export { estimateTokens } from "./loop/run";
