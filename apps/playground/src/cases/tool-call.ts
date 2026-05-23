/**
 * Case 2: Tool Calling
 *
 * 演示：
 * - 定义一个 ToolDef
 * - 通过 model adapter 进行 tool call streaming
 */

import { getModel } from "@helix/models";
import type { ToolDef } from "@helix/core";

export async function toolCall() {
  console.log("\n========== Case 2: Tool Call ==========\n");

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  // 定义一个简单的 tool
  const getWeatherTool: ToolDef = {
    name: "get_weather",
    description: "获取指定城市的天气",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称" },
      },
      required: ["city"],
    },
    execute: async ({ city }: { city: string }) => {
      return { weather: "晴天", temperature: 25, city };
    },
  };

  console.log("【Tool 定义】\n");
  console.log(`  name: ${getWeatherTool.name}`);
  console.log(`  description: ${getWeatherTool.description}`);
  console.log(`  parameters:`, JSON.stringify(getWeatherTool.parameters, null, 2));

  if (!hasOpenAI) {
    console.log("\n❌ OPENAI_API_KEY 未设置，跳过实际调用");
    console.log("   export OPENAI_API_KEY=sk-...");
    console.log("\n========== Case 2 结束 ==========\n");
    return;
  }

  const model = getModel("openai-compatible", "gpt-4o", {
    apiKey: process.env.OPENAI_API_KEY!,
  });

  if (!model) {
    console.log("❌ Model adapter 创建失败");
    return;
  }

  console.log("\n【Tool Call 测试】\n");

  const messages = [
    { role: "user" as const, content: "北京今天天气怎么样？", timestamp: Date.now() },
  ];

  console.log("  User: 北京今天天气怎么样？\n");
  console.log("  Assistant (streaming):\n  ");

  let hasToolCall = false;

  for await (const chunk of model.stream(messages, { tools: [getWeatherTool] })) {
    if (chunk.type === "text_delta") {
      process.stdout.write(chunk.value);
    }

    if (chunk.type === "tool_call_delta") {
      if (!hasToolCall) {
        console.log("\n\n  【Tool Call Detected】");
        hasToolCall = true;
      }
      process.stdout.write(".");
    }

    if (chunk.type === "tool_call") {
      console.log(`\n    toolCallId: ${chunk.toolCallId}`);
      console.log(`    name: ${chunk.name}`);
      console.log(`    args:`, chunk.args);
    }

    if (chunk.type === "done") {
      console.log("\n\n  ✅ stream 完成");
    }
  }

  console.log("\n========== Case 2 结束 ==========\n");
}
