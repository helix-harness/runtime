[English](./README.md) | [中文](./README.zh-CN.md)

# Helix Runtime

TypeScript-native, runtime-first Harness SDK for building AI Agents.

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
pnpm add @helix/runtime @helix/models @helix/core @helix/tools
```

```typescript
import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";
import { bashTool, readFileTool } from "@helix/tools";

const agent = new Agent({
  model: getModel({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  systemPrompt: "You are a helpful assistant.",
  tools: [bashTool(), readFileTool()],
});

// Observe all events
agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

// Run
await agent.prompt("List files in the current directory");
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

## Packages

| Package | Description |
|---|---|
| `@helix/core` | Zero-dependency shared types: `AgentMessage`, `ToolDef`, `ModelAdapter`, `AgentContext`, `Skill` |
| `@helix/runtime` | Harness core: `Agent`, `agentLoop`, `ToolRegistry`, `ToolExecutor`, Compaction, Session, Skill |
| `@helix/models` | LLM adapters: OpenAI-compatible, Anthropic-compatible |
| `@helix/tools` | Built-in tools: `readFileTool`, `writeFileTool`, `globTool`, `bashTool` |

```text
@helix/core        ← Zero-dependency shared types
      ↑         ↑         ↑
@helix/runtime  @helix/models  @helix/tools   ← Each depends on core
      ↑
Your Agent         ← Consumes the SDK
```

## Core Concepts

### Agent Class

A stateful wrapper that manages message accumulation, abort control, and event subscription.

```typescript
import { Agent } from "@helix/runtime";

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

**SteeringMode** controls concurrent prompt handling:

- `"one-at-a-time"` (default) — serial queue, each `prompt()` waits for the previous to finish
- `"all"` — concurrent execution

```typescript
const agent = new Agent({ model, steeringMode: "all" });
```

### Tool System

Tools are plain objects with a schema and an execute function:

```typescript
import type { ToolDef } from "@helix/core";

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

**Loop Hooks** give you control over tool execution:

```typescript
const agent = new Agent({
  model,
  tools: [myTool],
  beforeToolCall: async (ctx) => {
    console.log(`About to call: ${ctx.name}`);
    return "allow"; // or "block" to skip
  },
  afterToolCall: async (ctx) => {
    console.log(`Called ${ctx.name} in ${ctx.durationMs}ms`);
  },
  shouldStopAfterTurn: async (ctx) => {
    return ctx.turnCount >= 5; // Stop after 5 turns
  },
});
```

A tool can signal loop termination by returning `{ terminate: true }`.

### Built-in Tools

`@helix/tools` provides ready-to-use tools with safety features:

```typescript
import { readFileTool, writeFileTool, globTool, bashTool } from "@helix/tools";

const tools = [
  readFileTool({ rootDir: "./project", maxChars: 50000 }),
  writeFileTool({ rootDir: "./project", createDirs: true }),
  globTool({ rootDir: "./project", maxResults: 100 }),
  bashTool({
    cwd: "./project",
    timeoutMs: 30000,
    allowedCommands: ["ls", "cat", "grep"],
    blockedPatterns: ["rm -rf"],
  }),
];
```

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

### Multimodal

Both low-level and high-level APIs support image content:

```typescript
import { imagePart } from "@helix/core";

// Low-level: pass ContentPart[] to agentLoop
const msg = {
  role: "user",
  content: [
    textPart("What's in this image?"),
    imagePart(base64Data, "image/png"),
  ],
};

// High-level: Agent.prompt accepts ContentPart[]
await agent.prompt([
  textPart("Describe this"),
  imagePart(imageBuffer, "image/jpeg"),
]);
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

### Skill System

Skills are reusable prompt templates loaded from YAML/JSON files:

```typescript
import { loadSkills, formatSkillsForPrompt } from "@helix/runtime";

const { skills, diagnostics } = await loadSkills({ dirs: ["./skills"] });
const agent = new Agent({ model, skills });

// Invoke a skill programmatically
await agent.invokeSkill("code-review", { file: "src/index.ts" });
```

## Event System

`agentLoop` returns `AsyncIterable<AgentEvent>`. Every behavior is observable:

```
agent_start
  turn_start
    message_start / message_end        (user message)
    message_start
      message_update (streaming delta)
      thinking_update (extended thinking)
    message_end                        (assistant reply)
    tool_execution_start → tool_execution_end  (tool call)
    context_compacted                  (when compaction triggers)
  turn_end
agent_end
error                                (on failure)
```

13 event types covering the full agent lifecycle.

## Development

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm dev           # Dev mode (watch)
pnpm test          # Run tests
pnpm typecheck     # Type checking
pnpm lint          # Lint
```

Run playground cases:

```bash
cd apps/playground
pnpm dev -- basics     # Model streaming, Agent basics, agentLoop
pnpm dev -- tools      # Tool execution, hooks, parallel/sequential
pnpm dev -- context    # Compaction strategies
pnpm dev -- control    # AbortSignal, steering mode, thinking level
pnpm dev -- subagent   # Multi-agent orchestration
pnpm dev -- session    # Session persistence
pnpm dev -- multimodal # Image support
```

## Tech Stack

- **Language**: TypeScript 6, ESNext modules
- **Build**: tsup (ESM + DTS)
- **Orchestration**: Turborepo
- **Package Manager**: pnpm 10

## License

MIT
