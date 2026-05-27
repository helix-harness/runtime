[English](./README.md) | [中文](./README.zh-CN.md)

# Helix Runtime

A TypeScript-native, runtime-first harness SDK for building AI agents.

**Agent = Model + Harness**

Helix Runtime provides the execution layer — loop control, tool orchestration, event streaming, context management — so you can focus on what your agent does, not how it runs.

## Why Helix Runtime?

Most agent frameworks blur the line between "thinking" and "doing". Helix Runtime draws a clear boundary:

| Layer | Responsibility | Who does it |
|---|---|---|
| **Model** | Reasoning, generation, tool call decisions | GPT / Claude / Gemini |
| **Harness** | Loop control, tool execution, state management, event streaming | **Helix Runtime** |

You bring the model and the tools. Helix Runtime runs the loop.

## Quick Start

```bash
pnpm add @helix/runtime @helix/models @helix/core
```

```typescript
import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";

const agent = new Agent({
  model: getModel({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
});

// Observe all events
agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

// Run
await agent.prompt("Hello!");
```

### Stateless Loop (Low-level)

```typescript
import { agentLoop } from "@helix/runtime";

const context = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
};

for await (const event of agentLoop([userMsg], context, { model })) {
  if (event.type === "message_update") process.stdout.write(event.delta);
  if (event.type === "agent_end") context.messages.push(...event.messages);
}
```

## Core Concepts

### Agent Class

A stateful wrapper that manages message accumulation, abort control, and event subscription.

```typescript
const agent = new Agent({
  model,                              // ModelAdapter
  systemPrompt: "You are helpful.",   // System prompt
  tools: [myTool],                    // ToolDef[]
  convertToLlm: (msgs) => msgs,      // Filter messages for LLM
  transformContext: async (msgs) => { // Context pruning/compression
    return msgs.slice(-50);
  },
});

agent.subscribe(handler);  // Observe events
await agent.prompt("..."); // Send user message
await agent.continue();    // Resume from context
agent.abort();             // Cancel current run
agent.clearMessages();     // Reset state
```

### Tool System

Tools are plain objects with a schema and an execute function:

```typescript
const calculator: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression" },
    },
    required: ["expression"],
  },
  execute: async (args) => {
    return { result: eval(args.expression) };
  },
};
```

Execution modes: `parallel` (default) or `sequential` (set `executionMode: "sequential"` on the tool).

### Sub-agent

Wrap any `Agent` as a tool for multi-agent orchestration:

```typescript
import { createSubagentTool } from "@helix/runtime";

const specialist = new Agent({
  model,
  systemPrompt: "You are a domain specialist.",
  tools: [domainTool],
});

const orchestrator = new Agent({
  model,
  tools: [
    createSubagentTool({
      name: "specialist",
      description: "Delegate tasks to the domain specialist.",
      agent: specialist,
      onEvent: (e) => console.log("[specialist]", e.type),
    }),
  ],
});
```

### Context Compaction

Built-in strategies to keep conversation context under control:

```typescript
import { sliceCompaction, tokenCompaction, summaryCompaction, compose } from "@helix/runtime";

// Slice: keep last N messages
const agent = new Agent({
  model,
  transformContext: sliceCompaction({ keepLast: 20, triggerAt: 50 }),
});

// Token-based: keep recent tokens
const agent = new Agent({
  model,
  transformContext: tokenCompaction({ keepRecentTokens: 2000, triggerAtTokens: 4000 }),
});

// Summary: LLM-powered summarization
const agent = new Agent({
  model,
  transformContext: summaryCompaction({
    summaryModel: model,
    summaryInstructions: "Summarize in 2 sentences.",
    triggerAtTokens: 4000,
  }),
});

// Compose: chain multiple strategies
const agent = new Agent({
  model,
  transformContext: compose(
    customPrune,
    sliceCompaction({ keepLast: 20, triggerAt: 50 }),
  ),
});
```

### Session Persistence

```typescript
import { MemorySessionStore, FileSessionStore } from "@helix/runtime";

// In-memory (for testing)
const store = new MemorySessionStore();

// File-based (JSONL + meta)
const store = new FileSessionStore("./sessions");

const session = await store.create({ systemPrompt: "You are helpful." });
await store.save({ ...session, messages });
const loaded = await store.get(session.id);
```

## Event System

`agentLoop` returns `AsyncIterable<AgentEvent>`. Every behavior is observable:

```
agent_start
  turn_start
    message_start / message_end        (user)
    message_start
      message_update (streaming delta)
    message_end                        (assistant)
    tool_execution_start → tool_execution_end  (if tool call)
  turn_end
agent_end
```

## Architecture

```
@helix/core        ← Zero-dependency shared types (AgentMessage, ToolDef, ModelAdapter)
      ↑
@helix/runtime     ← Harness core (Agent, agentLoop, tools, compaction, session)
      ↑
@helix/models      ← LLM adapters (OpenAI-compatible, Anthropic-compatible)
      ↑
Your agent         ← Consumes the SDK
```

## Monorepo Structure

```text
packages/
├── core/          @helix/core     — Shared types (zero dependencies)
├── runtime/       @helix/runtime  — Harness core
└── models/        @helix/models   — LLM adapters

apps/
└── playground/    Development & testing playground
```

## Development

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm dev           # Dev mode (watch)
pnpm test          # Run tests
pnpm typecheck     # Type checking
pnpm lint          # Lint
```

Run a specific playground case:

```bash
cd apps/playground
pnpm dev -- model-basic
```

## License

MIT
