import Anthropic from "@anthropic-ai/sdk";
import type { ModelAdapter, AgentMessage, ToolDef, ModelChunk } from "@helix/core";
import type { ModelConfig } from "../types";

// ─── AnthropicAdapter ─────────────────────────────────────────────────────────

/**
 * Adapter for the Anthropic API (Claude models).
 *
 * Handles Anthropic's distinct streaming event format:
 *   content_block_start  → tool_use block opens
 *   content_block_delta  → text_delta or input_json_delta
 *   content_block_stop   → block finalized
 *   message_delta        → finish_reason (end_turn | tool_use)
 *
 * Buffers input_json_delta fragments per content block index,
 * then emits a complete tool_call chunk when the block closes.
 */
export class AnthropicAdapter implements ModelAdapter {
  private client: Anthropic;

  constructor(private options: ModelConfig) {
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

    // Per-block buffers: index → { id, name, jsonArgs }
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
        // ── New content block opened ──────────────────────────────────────
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolBlocks.set(event.index, {
              id: block.id,
              name: block.name,
              jsonArgs: "",
            });
            yield {
              type: "tool_call_delta",
              toolCallId: block.id,
              name: block.name,
              argsDelta: "",
            };
          }
          break;
        }

        // ── Delta within a content block ──────────────────────────────────
        case "content_block_delta": {
          const delta = event.delta;

          if (delta.type === "text_delta") {
            yield { type: "text_delta", value: delta.text };
          }

          if (delta.type === "input_json_delta") {
            const buf = toolBlocks.get(event.index);
            if (buf) {
              buf.jsonArgs += delta.partial_json;
              yield {
                type: "tool_call_delta",
                toolCallId: buf.id,
                name: buf.name,
                argsDelta: delta.partial_json,
              };
            }
          }
          break;
        }

        // ── Content block closed: emit complete tool_call ─────────────────
        case "content_block_stop": {
          const buf = toolBlocks.get(event.index);
          if (buf) {
            let args: unknown = {};
            try {
              args = buf.jsonArgs ? JSON.parse(buf.jsonArgs) : {};
            } catch {
              // Malformed JSON — emit with empty args
            }
            yield {
              type: "tool_call",
              toolCallId: buf.id,
              name: buf.name,
              args,
            };
            toolBlocks.delete(event.index);
          }
          break;
        }

        // ── Message finished ──────────────────────────────────────────────
        case "message_stop": {
          yield { type: "done" };
          break;
        }

        // Ignore: message_start, message_delta, ping
        default:
          break;
      }
    }
  }
}

// ─── Message Conversion ───────────────────────────────────────────────────────

/**
 * Anthropic requires system messages to be a top-level param, not in the
 * messages array. Extract the last system message (if any) and return it
 * separately from the conversation messages.
 */
function splitSystemMessage(messages: AgentMessage[]): {
  system: string | null;
  conversationMessages: AgentMessage[];
} {
  const lastSystem = [...messages].reverse().find((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");
  return { system: lastSystem?.content ?? null, conversationMessages };
}

function convertMessages(
  messages: AgentMessage[]
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    switch (m.role) {
      case "user":
        result.push({ role: "user", content: m.content });
        break;

      case "assistant":
        if (m.toolCalls?.length) {
          // Anthropic expects tool_use blocks inside the assistant content array
          const content: Anthropic.ContentBlock[] = [];

          if (m.content) {
            content.push({ type: "text", text: m.content });
          }

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
        // Anthropic tool results must be in a user message with tool_result blocks
        const last = result[result.length - 1];
        const block: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.content,
          is_error: m.isError ?? false,
        };

        if (last?.role === "user" && Array.isArray(last.content)) {
          // Append to existing tool-result user message
          (last.content as Anthropic.ToolResultBlockParam[]).push(block);
        } else {
          result.push({ role: "user", content: [block] });
        }
        break;
      }

      default:
        // Skip unknown types (e.g. UI-only messages)
        break;
    }
  }

  return result;
}

// ─── Tool Conversion ──────────────────────────────────────────────────────────

function convertTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool["input_schema"],
  }));
}
