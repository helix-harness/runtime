# @helix/tools

Built-in tools for the Helix agent runtime.

## Install

```bash
npm install @helix/tools
```

## Built-in Tools

- `readFileTool` — read file contents with optional offset/limit
- `writeFileTool` — create or overwrite files
- `globTool` — file pattern matching
- `bashTool` — execute shell commands (sandboxed)

## Quick Example

```ts
import { readFileTool, writeFileTool, bashTool } from "@helix/tools";

const agent = new Agent({
  tools: [
    readFileTool(),
    writeFileTool({ allowedDirs: ["/tmp"] }),
    bashTool(),
  ],
});
```
