# @helix/runtime

Harness runtime for building AI agents — agent loop, tool orchestration, event streaming.

## Install

```bash
npm install @helix/runtime @helix/models @helix/core @helix/tools
```

## What's inside

- **Agent** — stateful agent class with subscribe/abort/continue
- **agentLoop** — low-level stateless agent loop (returns `AsyncIterable<AgentEvent>`)
- **ToolRegistry / ToolExecutor** — tool registration and parallel/sequential execution
- **SkillRegistry** — skill management and auto-discovery
- **Context compaction** — slice, token, and summary-based context pruning
- **SessionStore** — in-memory and file-backed session persistence
- **createSubagentTool** — wrap an Agent as a Tool for multi-agent systems

## Quick Example

```ts
import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";
import { bashTool, readFileTool } from "@helix/tools";

const agent = new Agent({
  model: getModel("gpt-4o", { apiKey: process.env.OPENAI_API_KEY }),
  systemPrompt: "You are a helpful assistant.",
  tools: [bashTool(), readFileTool()],
});

agent.subscribe((event) => console.log(event));
await agent.prompt("List all TypeScript files in src/");
```
