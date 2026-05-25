/**
 * Case: Basic Agent Stream
 *
 * 验证：
 * - agent.prompt() 流式输出
 * - 事件序列完整
 */

import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";

export async function basic() {
  console.log("\n========== Case: Basic Stream ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  const modelId = process.env.LLM_MODEL_ID ?? "gpt-4o";

  const agent = new Agent({
    model: getModel({
      model: modelId,
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    }),
    systemPrompt: "你是一个简洁的助手，直接回答问题。",
  });

  // 收集事件顺序
  const eventOrder: string[] = [];
  agent.subscribe((e) => {
    eventOrder.push(e.type);
    if (e.type === "message_update") {
      process.stdout.write(e.delta);
    }
  });

  console.log("User: 你好\n");

  await agent.prompt("你好");

  console.log("\n\n事件顺序:", eventOrder.join(" → "));
  console.log("\n========== Case 结束 ==========\n");
}