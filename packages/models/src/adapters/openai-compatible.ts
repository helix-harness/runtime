import OpenAI from "openai";
import type { ModelAdapter, AgentMessage, ToolDef } from "@helix/core";
import type { ModelConfig } from "../registry";

export interface OpenAICompatibleAdapterOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

interface ToolCallBuffer {
  id: string;
  name?: string;
  arguments: string;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  private client: OpenAI;

  constructor(private options: OpenAICompatibleAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async *stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk> {
    const controller = new AbortController();
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort());
    }

    const toolCallBuffers = new Map<string, ToolCallBuffer>();

    const response = await this.client.chat.completions.create({
      model: this.options.model ?? "gpt-4o",
      messages: this.convertMessages(messages),
      stream: true,
      tools: opts.tools ? this.convertTools(opts.tools) : undefined,
    }, { signal: controller.signal as any });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { type: "text_delta", value: delta.content };
      }

      if (delta?.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const tcId = tc.id ?? "";

          if (!toolCallBuffers.has(tcId)) {
            toolCallBuffers.set(tcId, {
              id: tcId,
              arguments: "",
            });
          }

          const buffer = toolCallBuffers.get(tcId)!;

          if (tc.function?.name) {
            buffer.name = tc.function.name;
          }

          if (tc.function?.arguments) {
            buffer.arguments += tc.function.arguments;
          }

          yield {
            type: "tool_call_delta",
            toolCallId: tcId,
            name: buffer.name,
            args: buffer.arguments,
          };
        }
      }

      if (chunk.choices[0]?.finish_reason === "tool_calls") {
        for (const [toolCallId, buffer] of toolCallBuffers) {
          try {
            const args = buffer.arguments ? JSON.parse(buffer.arguments) : {};
            yield {
              type: "tool_call",
              toolCallId,
              name: buffer.name ?? "",
              args,
            };
          } catch {
            yield {
              type: "tool_call",
              toolCallId,
              name: buffer.name ?? "",
              args: {},
            };
          }
        }
        toolCallBuffers.clear();
        yield { type: "done" };
      } else if (chunk.choices[0]?.finish_reason) {
        yield { type: "done" };
      }
    }
  }

  private convertMessages(
    messages: AgentMessage[]
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "toolResult") {
        return {
          role: "tool" as const,
          tool_call_id: m.toolCallId ?? "",
          content: m.content,
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });
  }

  private convertTools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }
}

type ModelChunk =
  | { type: "text_delta"; value: string }
  | { type: "tool_call_delta"; toolCallId: string; name?: string; args?: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | { type: "done" };
