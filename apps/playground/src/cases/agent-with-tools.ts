/**
 * Case: Agent Class with Tool Calling
 *
 * 演示：
 * - Agent 有状态封装
 * - subscribe 监听所有事件
 * - tool_execution_start 事件
 * - prompt 自动累积 messages
 */

import { Agent } from "@helix/runtime";
import { createModel, checkEnv } from "./shared";

const getWeatherTool = {
  name: "get_weather",
  description: "获取指定城市的天气",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名称" },
    },
    required: ["city"],
  },
  execute: async (args: unknown) => {
    // 模拟 API 调用延迟
    await new Promise((r) => setTimeout(r, 500));
    const { city } = args as { city: string };
    return { city, weather: "晴天", temperature: 25 };
  },
};


export async function agentWithTools() {
  console.log("\n========== Case: Agent with Tools ==========\n");

  if (!checkEnv()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  // 创建 Agent
  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个智能助手，可以调用工具来回答问题。",
    tools: [getWeatherTool],
  });

  // 订阅所有事件
  agent.subscribe((e) => {
    switch (e.type) {
      case "agent_start":
        console.log("[event] agent_start");
        break;
      case "turn_start":
        console.log("[event] turn_start");
        break;
      case "message_start":
        console.log(`[event] message_start (${e.message.role})`);
        break;
      case "message_update":
        // 实时输出 streaming token
        process.stdout.write(e.delta);
        break;
      case "message_end":
        console.log(`\n[event] message_end`);
        break;
      case "tool_execution_start":
        console.log(`\n[event] tool_execution_start: ${e.name}(${JSON.stringify(e.args)})`);
        break;
      case "tool_execution_end":
        const status = e.isError ? "❌" : "✅";
        console.log(`[event] tool_execution_end: ${status} ${e.name} (${e.durationMs}ms)`);
        console.log(`  result: ${typeof e.result === "object" ? JSON.stringify(e.result) : e.result}`);
        break;
      case "turn_end":
        console.log(`[event] turn_end (${e.toolResults.length} tool results)`);
        break;
      case "agent_end":
        console.log(`[event] agent_end (${e.messages.length} messages)`);
        break;
      case "error":
        console.error(`[event] error: ${e.error.message} (fatal: ${e.fatal})`);
        break;
    }
  });

  // 运行
  console.log("User: 帮我查一下北京的天气\n");

  await agent.prompt("帮我查一下北京的天气");

  console.log("\n========== Case 结束 ==========\n");

  // 演示 messages 累积
  console.log("Agent messages 累积情况:");
  console.log(`  共 ${agent.getMessages().length} 条消息`);

  // 继续对话（messages 已累积）
  console.log("\n继续对话:");
  await agent.prompt("那上海呢？");
}
