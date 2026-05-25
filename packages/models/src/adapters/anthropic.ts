import Anthropic from "@anthropic-ai/sdk";
import type { ModelAdapter, AgentMessage, ToolDef, ModelChunk } from "@helix/core";

export interface AnthropicCompatibleAdapterOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
}

export class AnthropicCompatibleAdapter implements ModelAdapter {
  private client: Anthropic;

  constructor(private options: AnthropicCompatibleAdapterOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async *stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk> {
    const { system, conversationMessages } = splitSystemMessage(messages);

    const toolBlocks = new Map<
      number,
      { id: string; name: string; jsonArgs: string }
    >();

    const stream = this.client.messages.stream(
      {
        model: this.options.model ?? "claude-sonnet-4-20250514",
        max_tokens: this.options.maxTokens ?? 8192,
        system: system ?? undefined,
        messages: convertMessages(conversationMessages),
        tools: opts.tools?.length ? convertTools(opts.tools) : undefined,
      },
      { signal: opts.signal }
    );

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolBlocks.set(event.index, { id: block.id, name: block.name, jsonArgs: "" });
            yield { type: "tool_call_delta", toolCallId: block.id, name: block.name, argsDelta: "" };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text_delta", value: delta.text };
          }
          if (delta.type === "input_json_delta") {
            const buf = toolBlocks.get(event.index);
            if (buf) {
              buf.jsonArgs += delta.partial_json;
              yield { type: "tool_call_delta", toolCallId: buf.id, name: buf.name, argsDelta: delta.partial_json };
            }
          }
          break;
        }
        case "content_block_stop": {
          const buf = toolBlocks.get(event.index);
          if (buf) {
            let args: unknown = {};
            try {
              args = buf.jsonArgs ? JSON.parse(buf.jsonArgs) : {};
            } catch {}
            yield { type: "tool_call", toolCallId: buf.id, name: buf.name, args };
            toolBlocks.delete(event.index);
          }
          break;
        }
        case "message_stop":
          yield { type: "done" };
          break;
        default:
          break;
      }
    }
  }
}

function splitSystemMessage(messages: AgentMessage[]): {
  system: string | null;
  conversationMessages: AgentMessage[];
} {
  const lastSystem = [...messages].reverse().find((m) => m.role === "system");
  return {
    system: lastSystem?.content ?? null,
    conversationMessages: messages.filter((m) => m.role !== "system"),
  };
}

function convertMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "user":
        result.push({ role: "user", content: m.content });
        break;
      case "assistant":
        if (m.toolCalls?.length) {
          const content: Anthropic.Messages.ContentBlockParam[] = [];
          if (m.content) content.push({ type: "text", text: m.content });
          for (const tc of m.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.toolCallId,
              name: tc.name,
              input: tc.args as Record<string, unknown>,
            });
          }
          result.push({ role: "assistant", content });
        } else {
          result.push({ role: "assistant", content: m.content });
        }
        break;
      case "toolResult": {
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.content,
          is_error: m.isError ?? false,
        };
        const last = result[result.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          (last.content as Anthropic.ToolResultBlockParam[]).push(block);
        } else {
          result.push({ role: "user", content: [block] });
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}

function convertTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool["input_schema"],
  }));
}
