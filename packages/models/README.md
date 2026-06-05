# @helix/models

LLM model adapters for the Helix agent runtime.

## Install

```bash
npm install @helix/models
```

## Supported Adapters

- `OpenAICompatibleAdapter` — works with OpenAI, Groq, Ollama, and any OpenAI-compatible endpoint
- `AnthropicCompatibleAdapter` — Anthropic-specific adapter with extended thinking support
- `getModel()` — factory that picks the right adapter for you

## Quick Example

```ts
import { getModel } from "@helix/models";

const model = getModel({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});
// or
const model = getModel("claude-sonnet-4-6", {
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```
