import OpenAI from "openai";
import type { ModelAdapter, AgentMessage, ToolDef, ModelChunk } from "@helix/core";
import type { ModelConfig } from "../types";

// ─── OpenAICompatibleAdapter ──────────────────────────────────────────────────

/**
 * Adapter for any OpenAI-compatible API.
 * Works with: OpenAI, Groq, Ollama, Together, Fireworks, local servers, etc.
 *
 * Handles:
 * - Streaming text deltas
 * - Streaming tool call deltas (buffered until complete)
 * - AbortSignal passthrough
 * - toolResult messages → OpenAI "tool" role conversion
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  private client: OpenAI;

  constructor(private options: ModelConfig & { baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async *stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk> {
    // Buffer for accumulating streaming tool call arguments
    const toolCallBuffers = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const response = await this.client.chat.completions.create(
      {
        model: this.options.model ?? "gpt-4o",
        max_tokens: this.options.maxTokens ?? 8192,
        messages: convertMessages(messages),
        stream: true,
        tools: opts.tools?.length ? convertTools(opts.tools) : undefined,
      },
      { signal: opts.signal }
    );

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;

      // ── Text delta ────────────────────────────────────────────────────────
      if (delta?.content) {
        yield { type: "text_delta", value: delta.content };
      }

      // ── Tool call deltas ──────────────────────────────────────────────────
      if (delta?.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;

          if (!toolCallBuffers.has(index)) {
            toolCallBuffers.set(index, { id: "", name: "", arguments: "" });
          }

          const buf = toolCallBuffers.get(index)!;

          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.arguments += tc.function.arguments;

          // Emit delta for UIs that want to show streaming tool args
          yield {
            type: "tool_call_delta",
            toolCallId: buf.id,
            name: buf.name || undefined,
            argsDelta: tc.function?.arguments ?? "",
          };
        }
      }

      // ── Finish: flush complete tool calls ─────────────────────────────────
      if (finishReason === "tool_calls") {
        for (const buf of toolCallBuffers.values()) {
          let args: unknown = {};
          try {
            args = buf.arguments ? JSON.parse(buf.arguments) : {};
          } catch {
            // Malformed JSON from LLM — pass empty args, let runtime handle it
          }
          yield {
            type: "tool_call",
            toolCallId: buf.id,
            name: buf.name,
            args,
          };
        }
        toolCallBuffers.clear();
        yield { type: "done" };
      } else if (finishReason) {
        yield { type: "done" };
      }
    }
  }
}

// ─── Message Conversion ───────────────────────────────────────────────────────

function convertMessages(
  messages: AgentMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    switch (m.role) {
      case "system":
        result.push({ role: "system", content: m.content });
        break;

      case "user":
        result.push({ role: "user", content: m.content });
        break;

      case "assistant":
        if (m.toolCalls?.length) {
          // Assistant message with tool calls
          result.push({
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.toolCallId,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args),
              },
            })),
          });
        } else {
          result.push({ role: "assistant", content: m.content });
        }
        break;

      case "toolResult":
        result.push({
          role: "tool" as const,
          tool_call_id: m.toolCallId ?? "",
          content: m.content,
        });
        break;

      default:
        // Skip unknown message types (e.g. UI-only messages)
        break;
    }
  }

  return result;
}

// ─── Tool Conversion ──────────────────────────────────────────────────────────

function convertTools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}
