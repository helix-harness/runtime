/**
 * Case: Anthropic Tool Calling
 *
 * 验证 Anthropic adapter 下的 tool calling 流程
 * Anthropic 的 tool 消息格式和 OpenAI 不同，需要单独验证
 */

import { Agent, type AgentEvent } from "@helix/runtime";
import { createModel, checkAnthropic } from "./shared";
import type { ToolDef } from "@helix/core";

const weatherTool: ToolDef = {
  name: "get_weather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
      unit: {
        type: "string",
        enum: ["celsius", "fahrenheit"],
        description: "Temperature unit",
      },
    },
    required: ["city"],
  },
  execute: async (args: any) => {
    const { city, unit = "celsius" } = args;
    // Mock weather data
    const temp = unit === "celsius" ? 22 : 72;
    return {
      city,
      temperature: temp,
      unit,
      condition: "Sunny",
      humidity: 65,
    };
  },
};

async function testAnthropicToolCall() {
  console.log("【1】Anthropic — 单次 tool call\n");

  if (!checkAnthropic()) return;

  const agent = new Agent({
    model: createModel({ provider: "anthropic-compatible" }),
    systemPrompt: "You are a helpful weather assistant.",
    tools: [weatherTool],
  });

  const events: AgentEvent[] = [];

  agent.subscribe((e) => {
    events.push(e);
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") {
      console.log(`\n  → calling: ${e.name}(${JSON.stringify(e.args)})`);
    }
    if (e.type === "tool_execution_end") {
      console.log(`  ← result: ${JSON.stringify(e.result)}`);
    }
  });

  await agent.prompt("What's the weather like in Tokyo?");
  console.log("\n");

  const toolStart = events.find((e) => e.type === "tool_execution_start");
  const toolEnd = events.find((e) => e.type === "tool_execution_end") as any;

  console.assert(!!toolStart, "❌ tool_execution_start not emitted");
  console.assert(!!toolEnd, "❌ tool_execution_end not emitted");
  console.assert(!toolEnd?.isError, "❌ tool should not have errored");

  console.log("✅ Anthropic tool call 通过\n");
}

async function testAnthropicMultiTurn() {
  console.log("【2】Anthropic — 多轮对话 with tools\n");

  if (!checkAnthropic()) return;

  const agent = new Agent({
    model: createModel({ provider: "anthropic-compatible" }),
    systemPrompt: "You are a helpful assistant.",
    tools: [weatherTool],
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("What's the weather in Shanghai?");
  console.log("\n  [second turn]");
  await agent.prompt("And what about Beijing? Compare the two.");
  console.log("\n");

  const messages = agent.getMessages();
  console.log(`  total messages: ${messages.length}`);
  console.assert(messages.length >= 4, "❌ expected at least 4 messages across 2 turns");

  console.log("✅ Anthropic 多轮对话通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function anthropicToolCall() {
  console.log("\n========== v0.3: Anthropic Tool Calling ==========\n");

  if (!checkAnthropic()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  try {
    await testAnthropicToolCall();
    await testAnthropicMultiTurn();
    console.log("========== v0.3 Anthropic 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
