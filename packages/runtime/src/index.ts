// ─── Agent (stateful) ────────────────────────────────────────────────────────
export { Agent } from "./agent/agent";
export type { AgentOptions, SteeringMode } from "./agent/agent";

// ─── agentLoop (stateless) ───────────────────────────────────────────────────
export { agentLoop, agentLoopContinue } from "./loop/index";
export type { AgentLoopConfig, StreamFn } from "./loop/index";

// ─── Tools ───────────────────────────────────────────────────────────────────
export { ToolRegistry } from "./tool/ToolRegistry";
export { ToolExecutor } from "./tool/ToolExecutor";
export { createSubagentTool } from "./tool/subagent";
export type { SubagentToolOpts, SubagentInterface } from "./tool/subagent";

// ─── Events ──────────────────────────────────────────────────────────────────
export type { AgentEvent } from "./event/types";

// ─── Compaction (v0.5) ───────────────────────────────────────────────────────
export { sliceCompaction, tokenCompaction, summaryCompaction, compose } from "./compaction/index";
export type { TransformContextFn } from "./compaction/index";

// ─── Session (v0.6) ──────────────────────────────────────────────────────────
export { MemorySessionStore, FileSessionStore } from "./session/index";
export type { SessionStore, SessionData } from "./session/index";

// ─── Utils ───────────────────────────────────────────────────────────────────
export { estimateTokens } from "./loop/run";
