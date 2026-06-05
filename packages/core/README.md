# @helixharness/core

Shared types and interfaces for the Helix agent runtime — zero dependencies.

## Install

```bash
npm install @helixharness/core
```

## What's inside

- `AgentMessage` — message type with `user` | `assistant` | `toolResult` | `system` | custom roles
- `AgentContext` — the context object passed through every turn
- `ToolDef` / `ToolResult` — tool definition and execution result types
- `ContentPart` / `ImageContent` — multi-modal content types
- `ModelAdapter` — the interface every LLM adapter must implement

## Quick Example

```ts
import type { AgentMessage, ToolDef, ToolResult } from "@helixharness/core";

const message: AgentMessage = {
  role: "user",
  content: "Hello, world!",
  timestamp: Date.now(),
};
```
