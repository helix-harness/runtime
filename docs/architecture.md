[English](./architecture.md) | [中文](./architecture.zh-CN.md)

# Helix Runtime — Architecture

> A minimal, extensible Harness Runtime SDK for building AI Agents.

---

## 1. Positioning

```
@helix/runtime is a Harness Runtime SDK.

Not AI. Not an Agent product.
It is the execution-layer infrastructure that lets anyone build Agents quickly.
```

With the SDK and a Model, you can assemble a complete Agent:

```ts
import { Agent } from "@helix/runtime"
import { getModel } from "@helix/models"

const agent = new Agent({
  model: getModel({ model: "gpt-4o", apiKey: process.env.LLM_API_KEY }),
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
})

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta)
  }
})

await agent.prompt("Help me with this task")
```

---

## 2. Core Concepts

### 2.1 Agent = Model + Harness

```
Agent = Model + Harness
           ↑
  @helix/runtime IS the Harness
```

| Layer | Responsibility | Who |
|---|---|---|
| **Model** (Thinking) | Reasoning, generation, tool call decisions | GPT / Claude / Gemini |
| **Harness** (Execution) | Loop control, tool execution, state management, event streaming | **@helix/runtime** |

### 2.2 What the Harness Handles

- Agent loop control (multi-turn, tool call processing)
- Tool orchestration (registration, execution, parallel/sequential, error handling)
- Message transformation (AgentMessage -> LLM Message)
- Context management (pruning, compaction)
- Event streaming (all behavior is event-driven)
- Loop hooks (beforeToolCall, afterToolCall, shouldStopAfterTurn)
- Cancellation (AbortSignal)
- Session persistence (memory / file-based)

### 2.3 What the Harness Does NOT Handle

- Business logic
- Prompt engineering
- Agent product design
- Storage backends (beyond built-in session stores)

---

## 3. Package Structure

### 3.1 Packages

| Package | Purpose | Dependencies |
|---|---|---|
| `@helix/core` | Shared types: AgentMessage, AgentContext, ToolDef, ModelAdapter | Zero |
| `@helix/runtime` | Harness core: Agent, agentLoop, tools, compaction, session, events | `@helix/core` |
| `@helix/models` | LLM adapters: OpenAI-compatible, Anthropic-compatible | `@helix/core` |

### 3.2 Dependency Graph

```
@helix/core        (zero dependencies)
      ↑         ↑
@helix/runtime  @helix/models    (independent, both depend on core)
      ↑
Your Agent         (consumes the SDK)
```

### 3.3 Source Layout

```
packages/
├── core/src/
│   ├── message.ts          AgentMessage, ToolCallRef
│   ├── tool.ts             ToolDef, ToolResult
│   ├── context.ts          AgentContext
│   ├── adapter.ts          ModelAdapter, ModelChunk
│   └── index.ts
│
├── runtime/src/
│   ├── agent/agent.ts      Agent class (stateful wrapper)
│   ├── loop/
│   │   ├── index.ts        agentLoop(), agentLoopContinue()
│   │   └── run.ts          runAgentLoop() implementation
│   ├── tool/
│   │   ├── ToolRegistry.ts Tool registration and lookup
│   │   ├── ToolExecutor.ts Parallel / sequential execution
│   │   └── subagent.ts     createSubagentTool()
│   ├── compaction/index.ts sliceCompaction, tokenCompaction, summaryCompaction, compose
│   ├── session/index.ts    MemorySessionStore, FileSessionStore
│   ├── event/types.ts      AgentEvent type definitions
│   └── index.ts
│
├── models/src/
│   ├── adapters/openai.ts  OpenAI-compatible adapter
│   ├── adapters/anthropic.ts Anthropic-compatible adapter
│   ├── getModel.ts         getModel() factory
│   └── index.ts
│
apps/
└── playground/src/cases/   15+ test cases covering all features
```

---

## 4. Message Pipeline

### 4.1 AgentMessage vs LLM Message

This is one of the most important design decisions in the SDK.

```
AgentMessage[]                   LLM Message[]
(app layer, extensible)          (LLM only understands these)
────────────────  convertToLlm()  ─────────────────
user                    →        user
assistant               →        assistant
toolResult              →        toolResult
system                  →        (filtered out or kept)
custom_ui_msg           →        (filtered out)
custom_app_msg          →        (converted)
```

`AgentMessage` supports arbitrary custom roles via TypeScript declaration merging. The LLM only understands standard roles. `convertToLlm` is the core extension point for business agents.

### 4.2 Full Pipeline

```
AgentMessage[]
    ↓
transformContext()      Optional: prune old messages, inject external context (long session)
    ↓
AgentMessage[]
    ↓
convertToLlm()          Required: filter UI-only messages, convert custom types
    ↓
LLM Message[]
    ↓
ModelAdapter.stream()   Call the LLM
```

### 4.3 Usage Example

```ts
const agent = new Agent({
  model,
  // Filter messages for LLM
  convertToLlm: (messages) =>
    messages.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),

  // Context pruning for long sessions
  transformContext: async (messages) => messages.slice(-50),
})
```

---

## 5. Event-Driven Architecture

### 5.1 Core Principle

```
All harness behavior is observable via events.
agentLoop returns AsyncIterable<AgentEvent>.
```

### 5.2 Event Lifecycle

```
agent.prompt("task")
├── agent_start
├── turn_start
│   ├── message_start     { userMessage }
│   ├── message_end       { userMessage }
│   ├── message_start     { assistantMessage }
│   ├── message_update    { delta }              ← streaming token
│   ├── message_end       { assistantMessage }
│   ├── tool_execution_start  { name, args }     ← if tool call
│   ├── tool_execution_end    { result, isError }
│   └── turn_end          { message, toolResults }
│
├── turn_start             ← LLM continues after tool results
│   └── ...
└── agent_end              { messages }
```

### 5.3 AgentEvent Type

```ts
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end";              messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end";               message: AgentMessage; toolResults: ToolResult[] }
  | { type: "message_start";          message: AgentMessage }
  | { type: "message_update";         message: AgentMessage; delta: string }
  | { type: "message_end";            message: AgentMessage }
  | { type: "tool_execution_start";   toolCallId: string; name: string; args: unknown }
  | { type: "tool_execution_end";     toolCallId: string; name: string; result: unknown; isError: boolean; durationMs: number }
  | { type: "context_compacted";      tokensBefore: number; tokensAfter: number }
  | { type: "error";                  error: Error; fatal: boolean }
```

### 5.4 Event Consumers

| Capability | Events Used |
|---|---|
| Real-time UI rendering | `message_update`, `tool_execution_*` |
| Replay | All events (replay by sequence) |
| Debugger | All events (breakpoint on type) |
| Observability | `turn_end`, `agent_end`, `error` |
| Tracing | All events (aggregate by sessionId) |

---

## 6. Core API

### 6.1 Two Usage Patterns

**Pattern A: Agent Class (recommended, stateful)**

```ts
const agent = new Agent({
  model,
  systemPrompt: "You are helpful.",
  tools: [myTool],
  convertToLlm: (msgs) => msgs.filter(m => ["user","assistant","toolResult"].includes(m.role)),
  transformContext: async (msgs) => msgs.slice(-50),
  beforeToolCall: async ({ name, args }) => "allow",         // can block dangerous tools
  afterToolCall: async ({ name, result, isError }) => {},    // post-processing
  shouldStopAfterTurn: async ({ toolResults }) => false,     // control loop continuation
})

agent.subscribe(handler)
await agent.prompt("task", { signal: abortController.signal })
await agent.continue()         // resume from current context (e.g. after error)
agent.abort()                  // cancel current loop
agent.clearMessages()          // reset state
```

**Pattern B: agentLoop Function (low-level, stateless)**

```ts
const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
}

for await (const event of agentLoop(
  [{ role: "user", content: "task", timestamp: Date.now() }],
  context,
  { model, signal: abortController.signal }
)) {
  if (event.type === "message_update") process.stdout.write(event.delta)
  if (event.type === "agent_end") {
    context.messages.push(...event.messages)  // caller manages context
  }
}
```

### 6.2 Key Types

**AgentContext** — stateless, passed into agentLoop each call:

```ts
interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDef[]
}
```

**ToolDef** — tool definition with JSON Schema:

```ts
interface ToolDef<TArgs = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>        // JSON Schema
  execute: (args: TArgs) => Promise<unknown>
  executionMode?: "parallel" | "sequential"  // default: parallel
}
```

**ModelAdapter** — contract between runtime and any LLM:

```ts
interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk>
}

type ModelChunk =
  | { type: "text_delta";      value: string }
  | { type: "tool_call_delta"; toolCallId: string; name?: string; argsDelta: string }
  | { type: "tool_call";       toolCallId: string; name: string; args: unknown }
  | { type: "done" }
```

Only `stream()` — no separate complete/stream, unified as AsyncIterable.

---

## 7. Tool System

### 7.1 Tool Registration

```ts
const calculator: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  execute: async (args) => {
    return { result: eval(args.expression) }
  },
}

const agent = new Agent({ model, tools: [calculator] })
```

### 7.2 Execution Modes

- **parallel** (default): all tool calls in a turn execute concurrently
- **sequential**: set `executionMode: "sequential"` on a tool; if any tool in a batch is sequential, the entire batch runs sequentially

### 7.3 Error Handling

Tool execution errors never abort the loop. Instead:
- `ToolResult.isError` is set to `true`
- The error message is sent back to the LLM as a tool result
- The LLM decides how to recover

---

## 8. Multi-Agent (Sub-agent as Tool)

### 8.1 Design Principle

```
Multi-agent ≠ agents communicating with each other
Multi-agent = Agent as Tool (child agent is a tool of the parent agent)
```

No extra orchestration layer. Reuses the existing tool mechanism — the parent agent calls a tool that runs the child agent's loop.

### 8.2 Implementation

```ts
import { createSubagentTool } from "@helix/runtime"

const codeReviewAgent = new Agent({
  model: getModel({ provider: "anthropic-compatible", model: "claude-sonnet-4-20250514", apiKey }),
  systemPrompt: "You are a code review expert.",
  tools: [readFileTool],
})

const parentAgent = new Agent({
  model,
  systemPrompt: "You are a project manager.",
  tools: [
    createSubagentTool({
      name: "code_review",
      description: "Delegate code review to a specialist.",
      agent: codeReviewAgent,
      onEvent: (e) => console.log("[review]", e.type),
    }),
  ],
})

await parentAgent.prompt("Review all files in src/")
```

### 8.3 Event Forwarding

Child agent events are forwarded via the `onEvent` callback. This allows the parent agent's subscribers to observe child agent activity without mixing event streams.

---

## 9. Context Compaction

### 9.1 Problem

Long-running sessions cause the context window to approach token limits. A compaction strategy is needed.

### 9.2 Built-in Strategies

**sliceCompaction** — keep last N messages when threshold is exceeded:

```ts
transformContext: sliceCompaction({ keepLast: 20, triggerAt: 50 })
```

**tokenCompaction** — keep recent messages within a token budget:

```ts
transformContext: tokenCompaction({ keepRecentTokens: 2000, triggerAtTokens: 4000 })
```

**summaryCompaction** — LLM-powered summarization of old messages:

```ts
transformContext: summaryCompaction({
  summaryModel: model,
  summaryInstructions: "Summarize in 2 sentences.",
  triggerAtTokens: 4000,
})
```

**compose** — chain multiple strategies:

```ts
transformContext: compose(
  customPrune,
  sliceCompaction({ keepLast: 20, triggerAt: 50 }),
)
```

### 9.3 Mechanism

The runtime calls `transformContext` before each LLM call. If token count decreases after transformation, a `context_compacted` event is emitted.

---

## 10. Session Persistence

### 10.1 Built-in Stores

```ts
import { MemorySessionStore, FileSessionStore } from "@helix/runtime"

// In-memory (testing)
const store = new MemorySessionStore()

// File-based (JSONL + meta.json per session)
const store = new FileSessionStore("./sessions")
```

### 10.2 SessionStore Interface

```ts
interface SessionStore {
  create(opts?: { systemPrompt?: string; metadata?: Record<string, unknown> }): Promise<SessionData>
  get(id: string): Promise<SessionData | undefined>
  save(session: SessionData): Promise<void>
  list(): Promise<string[]>
  delete(id: string): Promise<void>
}
```

---

## 11. Cancellation (AbortSignal)

```ts
const controller = new AbortController()

// User clicks cancel
cancelButton.onclick = () => controller.abort()

// Pass to agent
await agent.prompt("long task", { signal: controller.signal })

// Or pass to low-level loop
for await (const event of agentLoop(msgs, context, { model, signal: controller.signal })) { ... }
```

AbortSignal is forwarded to: `ModelAdapter.stream()`, tool execution, and `transformContext`. On abort, the loop exits immediately and emits `agent_end`.

---

## 12. Architecture Diagram

```
┌──────────────────────────────────────────────┐
│         Your Agent Project (separate repo)   │
│   coding-agent / web-agent / custom-agent    │
│   Consumes @helix/runtime SDK                │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│             @helix/runtime                   │
│           (Harness / Kernel)                 │
│                                              │
│  Agent class ──→ agentLoop()                 │
│                    ↓                         │
│  convertToLlm  transformContext              │
│  beforeToolCall  afterToolCall               │
│  shouldStopAfterTurn  AbortSignal            │
│                    ↓                         │
│  ToolRegistry + ToolExecutor (parallel)      │
│  createSubagentTool (multi-agent)            │
│  sliceCompaction / tokenCompaction / summary │
│  MemorySessionStore / FileSessionStore       │
│                    ↓                         │
│  AsyncIterable<AgentEvent>                   │
└──────────────────────────────────────────────┘
          ↓                      ↓
   @helix/models           Your Tools
          ↓                      ↓
         LLM              Execution Layer
```

---

## 13. Design Principles

| Principle | Description |
|---|---|
| Agent First | `Agent = Model + Harness` — AI capability and execution control are separated |
| Runtime First | All agent behavior must go through the runtime |
| Event First | All runtime behavior must be observable — `agentLoop` returns `AsyncIterable` |
| Stateless Loop | `agentLoop` is a pure function; `Agent` class provides stateful wrapping on top |
| No Premature Abstraction | No complex mechanisms until real demand appears |

**Minimum required abstractions:**

- Tool registry + executor (with parallel mode)
- ModelAdapter interface
- convertToLlm + transformContext (message pipeline)
- AbortSignal (cancellation)
- beforeToolCall / afterToolCall / shouldStopAfterTurn (hooks)
- createSubagentTool (multi-agent)

**Explicitly avoided (until truly needed):**

- Agent-to-agent communication protocols
- Workflow engine / DSL
- Memory / RAG system
- Plugin system

---

## 14. Architecture Decision Records (ADR)

| # | Decision | Outcome |
|---|---|---|
| 1 | agentLoop return type | `AsyncIterable<AgentEvent>` — streaming and events unified |
| 2 | AgentContext vs Session | Stateless `AgentContext`; `Agent` class provides stateful wrapper on top |
| 3 | Message pipeline | `convertToLlm` (required) + `transformContext` (optional) — business-layer extension points |
| 4 | ModelAdapter interface | Only `stream()` — no separate complete/stream, unified AsyncIterable |
| 5 | Tool execution failure | `isError: true` result sent back to LLM; emits `tool_execution_end`; does not abort |
| 6 | Tool parallel mode | Default parallel; per-tool `sequential` option; any sequential tool degrades entire batch |
| 7 | Multi-agent | Agent as Tool (`createSubagentTool`) — reuses tool mechanism, no orchestration layer |
| 8 | Context compaction | Via `transformContext` hook; runtime provides built-in strategies, does not enforce any |
| 9 | Cancellation | AbortSignal forwarded to model, tool, transformContext; abort emits `agent_end` |
| 10 | Session persistence | Built-in `MemorySessionStore` and `FileSessionStore`; custom stores via `SessionStore` interface |
