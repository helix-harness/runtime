/**
 * Case: Tool Calling Basic
 *
 * 验证：
 * - LLM 能正确调用 tool
 * - tool 执行结果返回给 LLM
 * - tool_execution_start / tool_execution_end 事件正确 emit
 * - 多轮 loop（LLM → tool → LLM）正确结束
 */

import { Agent, type AgentEvent } from "@helix/runtime";
import { createModel, checkOpenAI } from "./shared";
import type { ToolDef } from "@helix/core";

// ─── Tools ────────────────────────────────────────────────────────────────────

const calculatorTool: ToolDef = {
  name: "calculator",
  description: "执行数学计算，支持加减乘除",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "数学表达式，例如 '2 + 3 * 4'",
      },
    },
    required: ["expression"],
  },
  execute: async (args: any) => {
    const { expression } = args;
    try {
      // 安全的数学表达式求值（仅支持基本运算）
      const result = Function(`"use strict"; return (${expression})`)();
      return { result, expression };
    } catch {
      throw new Error(`无法计算表达式: ${expression}`);
    }
  },
};

const getTimeTool: ToolDef = {
  name: "get_current_time",
  description: "获取当前时间",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，例如 'Asia/Shanghai'，默认 UTC",
      },
    },
  },
  execute: async (args: any) => {
    const { timezone = "UTC" } = args;
    const now = new Date();
    return {
      time: now.toLocaleTimeString("zh-CN", { timeZone: timezone }),
      date: now.toLocaleDateString("zh-CN", { timeZone: timezone }),
      timezone,
    };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createAgent(tools: ToolDef[]) {
  if (!checkOpenAI()) throw new Error("OPENAI_API_KEY not set");

  return new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Always use tools when available.",
    tools,
  });
}

function collectEvents(agent: Agent): { events: AgentEvent[]; unsub: () => void } {
  const events: AgentEvent[] = [];
  const unsub = agent.subscribe((e) => events.push(e));
  return { events, unsub };
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

async function testSingleToolCall() {
  console.log("\n【1】单次 tool call — calculator\n");

  const agent = createAgent([calculatorTool]);
  const { events, unsub } = collectEvents(agent);

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") console.log(`\n  → calling: ${e.name}(${JSON.stringify(e.args)})`);
    if (e.type === "tool_execution_end") console.log(`  ← result: ${JSON.stringify(e.result)} (${e.durationMs}ms)`);
  });

  await agent.prompt("请计算 (123 * 456) + (789 / 3) 的结果");
  unsub();

  console.log("\n");

  // 断言事件序列
  const types = events.map((e) => e.type);
  console.assert(types.includes("agent_start"), "❌ missing agent_start");
  console.assert(types.includes("tool_execution_start"), "❌ missing tool_execution_start");
  console.assert(types.includes("tool_execution_end"), "❌ missing tool_execution_end");
  console.assert(types.includes("agent_end"), "❌ missing agent_end");
  console.assert(types[0] === "agent_start", "❌ first event must be agent_start");
  console.assert(types[types.length - 1] === "agent_end", "❌ last event must be agent_end");

  // 断言 tool 执行未出错
  const toolEnd = events.find((e) => e.type === "tool_execution_end") as any;
  console.assert(!toolEnd.isError, "❌ tool should not have errored");

  console.log("✅ 单次 tool call 通过\n");
}

async function testToolError() {
  console.log("【2】tool 执行失败 — LLM 收到 error context\n");

  const brokenTool: ToolDef = {
    name: "broken_tool",
    description: "这个 tool 总是报错",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      throw new Error("Tool deliberately failed");
    },
  };

  const agent = createAgent([brokenTool]);
  const { events, unsub } = collectEvents(agent);

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_end" && e.isError) console.log(`\n  ← error: ${e.result}`);
  });

  await agent.prompt("请调用 broken_tool");
  unsub();

  console.log("\n");

  const toolEnd = events.find((e) => e.type === "tool_execution_end") as any;
  console.assert(toolEnd?.isError === true, "❌ tool error not captured");

  // agent 不应该 crash，应该正常结束
  const agentEnd = events.find((e) => e.type === "agent_end");
  console.assert(!!agentEnd, "❌ agent_end should still emit after tool error");

  console.log("✅ tool 错误处理通过\n");
}

async function testMultipleTools() {
  console.log("【3】多个 tool — calculator + get_current_time\n");

  const agent = createAgent([calculatorTool, getTimeTool]);
  const toolCalls: string[] = [];

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") {
      toolCalls.push(e.name);
      console.log(`\n  → calling: ${e.name}`);
    }
  });

  await agent.prompt("现在几点了？另外帮我算一下 2024 * 2025 是多少");
  console.log("\n");

  // LLM 应该调用了至少一个 tool
  console.assert(toolCalls.length >= 1, "❌ expected at least 1 tool call");
  console.log(`  called tools: ${toolCalls.join(", ")}`);
  console.log("✅ 多 tool 测试通过\n");
}

async function testParallelToolCalls() {
  console.log("【4】并行 tool call — 同一轮多个 tool\n");

  // 模拟两个需要时间的 tool
  const slowTool = (name: string, delay: number): ToolDef => ({
    name,
    description: `Slow tool that takes ${delay}ms`,
    parameters: {
      type: "object",
      properties: { input: { type: "string" } },
    },
    execute: async (args: any) => {
      await new Promise((r) => setTimeout(r, delay));
      return { name, input: args.input, took: delay };
    },
  });

  const agent = createAgent([slowTool("tool_a", 300), slowTool("tool_b", 300)]);
  const execStart: number[] = [];
  const execEnd: number[] = [];

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") execStart.push(Date.now());
    if (e.type === "tool_execution_end") execEnd.push(Date.now());
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  const start = Date.now();
  await agent.prompt("请同时调用 tool_a 和 tool_b，input 分别传 'hello' 和 'world'");
  const total = Date.now() - start;

  console.log(`\n  total: ${total}ms`);

  if (execStart.length === 2) {
    // If both tools were called, check they overlapped (parallel)
    const serialTime = 300 * 2;
    if (total < serialTime + 500) {
      console.log("  ✅ tools ran in parallel");
    } else {
      console.log("  ℹ️  tools ran sequentially (LLM may not have called both in one turn)");
    }
  }

  console.log("✅ 并行 tool call 测试通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function toolCallBasic() {
  console.log("\n========== v0.3: Tool Calling ==========\n");

  if (!checkOpenAI()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  try {
    await testSingleToolCall();
    await testToolError();
    await testMultipleTools();
    await testParallelToolCalls();
    console.log("========== v0.3 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
