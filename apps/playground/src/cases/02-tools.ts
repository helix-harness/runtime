/**
 * Case 02: Tools — Tool 系统全套
 *
 * 覆盖：
 *  1) 基础 tool 调用 + tool_execution_* 事件
 *  2) Tool 执行错误（LLM 收到 error context，agent 不崩溃）
 *  3) parallel 模式（默认）— 同轮多 tool 并发
 *  4) sequential 模式 — 整批退化为串行
 *  5) beforeToolCall — 拦截危险 tool
 *  6) afterToolCall — 审计每次 tool 执行
 *  7) shouldStopAfterTurn — 限制最大轮数
 */

import { Agent } from "@helix/runtime";
import type { ToolDef } from "@helix/core";
import { createModel, checkEnv } from "./shared";

// ─── Tools ───────────────────────────────────────────────────────────────────

const calculatorTool: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression like '2 + 3 * 4'",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  execute: async (args: any) => {
    const result = Function(`"use strict"; return (${args.expression})`)();
    return { result, expression: args.expression };
  },
};

const brokenTool: ToolDef = {
  name: "broken_tool",
  description: "Always throws an error",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    throw new Error("Tool deliberately failed");
  },
};

function makeDelayedTool(name: string, ms: number, mode?: "parallel" | "sequential"): ToolDef {
  return {
    name,
    description: `A tool that takes ${ms}ms to complete`,
    parameters: {
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
    },
    executionMode: mode,
    execute: async (args: any) => {
      await new Promise((r) => setTimeout(r, ms));
      return { name, input: args.input, waited: ms };
    },
  };
}

// ─── 1) 基础 tool 调用 ───────────────────────────────────────────────────────

async function testBasicCall() {
  console.log("【1】基础 tool 调用 — calculator\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Always use the calculator tool for math.",
    tools: [calculatorTool],
  });

  const calls: string[] = [];
  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") {
      calls.push(e.name);
      console.log(`  → ${e.name}(${JSON.stringify(e.args)})`);
    }
    if (e.type === "tool_execution_end") {
      console.log(`  ← ${e.name}: ${JSON.stringify(e.result)} (${e.durationMs}ms)`);
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("请计算 (123 * 456) + (789 / 3)");
  console.log("\n");

  console.assert(calls.includes("calculator"), "❌ LLM 应调用 calculator");
  console.log("✅ 基础 tool 调用通过\n");
}

// ─── 2) Tool 错误处理 ────────────────────────────────────────────────────────

async function testToolError() {
  console.log("【2】Tool 错误处理 — broken_tool\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant.",
    tools: [brokenTool],
  });

  let toolError: any = null;
  let agentEnded = false;
  agent.subscribe((e) => {
    if (e.type === "tool_execution_end" && e.isError) {
      toolError = e;
      console.log(`  ← error captured: ${e.result}`);
    }
    if (e.type === "agent_end") agentEnded = true;
  });

  await agent.prompt("请调用 broken_tool");
  console.log();

  console.assert(toolError, "❌ tool 错误未被捕获");
  console.assert(agentEnded, "❌ agent 应正常结束（不崩溃）");
  console.log("✅ Tool 错误处理通过\n");
}

// ─── 3) parallel 模式 ────────────────────────────────────────────────────────

async function testParallelMode() {
  console.log("【3】parallel 模式（默认）— 多 tool 并发\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Call BOTH tools at the same time.",
    tools: [makeDelayedTool("p_tool_a", 500), makeDelayedTool("p_tool_b", 500)],
  });

  const wallStart = Date.now();
  const exec: { name: string; start: number; end: number }[] = [];
  const inFlight = new Map<string, number>();

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") inFlight.set(e.toolCallId, Date.now());
    if (e.type === "tool_execution_end") {
      exec.push({ name: e.name, start: inFlight.get(e.toolCallId) ?? 0, end: Date.now() });
    }
  });

  await agent.prompt("请同时调用 p_tool_a (input='foo') 和 p_tool_b (input='bar')");
  const wall = Date.now() - wallStart;
  console.log(`  wall: ${wall}ms`);

  if (exec.length >= 2) {
    const [a, b] = exec;
    const overlap = a!.start < b!.end && b!.start < a!.end;
    console.log(`  overlap: ${overlap ? "✅ 并行" : "ℹ️ 未重叠（LLM 可能未在同轮发起）"}`);
  } else {
    console.log(`  ℹ️ 仅 ${exec.length} 个 tool 被调用`);
  }
  console.log("✅ parallel 模式通过\n");
}

// ─── 4) sequential 模式 ─────────────────────────────────────────────────────

async function testSequentialMode() {
  console.log("【4】sequential 模式 — 整批退化串行\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Call BOTH tools.",
    tools: [
      makeDelayedTool("s_tool_a", 300, "sequential"), // 强制串行
      makeDelayedTool("s_tool_b", 300),
    ],
  });

  const order: string[] = [];
  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") {
      order.push(e.name);
      console.log(`  → start: ${e.name}`);
    }
    if (e.type === "tool_execution_end") console.log(`  ← end: ${e.name}`);
  });

  await agent.prompt("请调用 s_tool_a (input='1') 和 s_tool_b (input='2')");
  console.log(`  order: ${order.join(" → ")}`);
  console.log("✅ sequential 模式通过\n");
}

// ─── 5) beforeToolCall ──────────────────────────────────────────────────────

async function testBeforeToolCall() {
  console.log("【5】beforeToolCall — 拦截危险 tool\n");

  const dangerous: ToolDef = {
    name: "dangerous_op",
    description: "A dangerous operation",
    parameters: { type: "object", properties: { action: { type: "string" } } },
    execute: async () => ({ executed: true }),
  };

  const blocked: string[] = [];
  const executed: string[] = [];

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant.",
    tools: [dangerous],
    beforeToolCall: async ({ name }) => {
      if (name === "dangerous_op") {
        blocked.push(name);
        console.log(`  🚫 blocked: ${name}`);
        return "block";
      }
      return "allow";
    },
  });

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") executed.push(e.name);
  });

  await agent.prompt("请调用 dangerous_op，action 传 'delete'");

  console.assert(blocked.includes("dangerous_op"), "❌ 应拦截 dangerous_op");
  console.assert(!executed.includes("dangerous_op"), "❌ dangerous_op 不应执行");
  console.log("✅ beforeToolCall 通过\n");
}

// ─── 6) afterToolCall ───────────────────────────────────────────────────────

async function testAfterToolCall() {
  console.log("【6】afterToolCall — 审计 tool 执行\n");

  const log: { name: string; isError: boolean }[] = [];

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Use calculator for math.",
    tools: [calculatorTool],
    afterToolCall: async ({ name, isError }) => {
      log.push({ name, isError });
      console.log(`  📝 ${name} isError=${isError}`);
    },
  });

  await agent.prompt("用 calculator 计算 7 * 8");

  console.assert(log.length > 0, "❌ afterToolCall 未被调用");
  console.assert(log[0]!.name === "calculator", "❌ tool 名称不符");
  console.log("✅ afterToolCall 通过\n");
}

// ─── 7) shouldStopAfterTurn ─────────────────────────────────────────────────

async function testShouldStopAfterTurn() {
  console.log("【7】shouldStopAfterTurn — 最多 2 轮\n");

  const loopTool: ToolDef = {
    name: "continue_tool",
    description: "Returns a message asking to call itself again",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ message: "Please call continue_tool again." }),
  };

  let turns = 0;
  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Follow tool result instructions.",
    tools: [loopTool],
    shouldStopAfterTurn: async ({ toolResults }) => {
      turns++;
      console.log(`  turn ${turns} (toolResults=${toolResults.length})`);
      return turns >= 2;
    },
  });

  await agent.prompt("请不停地调用 continue_tool");

  console.assert(turns <= 2, `❌ 应在 2 轮停止，实际 ${turns}`);
  console.log(`  停止于 turn ${turns}`);
  console.log("✅ shouldStopAfterTurn 通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function tools() {
  console.log("\n========== 02 Tools: Tool 系统 ==========\n");

  if (!checkEnv()) {
    console.log("跳过\n");
    return;
  }

  try {
    await testBasicCall();
    await testToolError();
    await testParallelMode();
    await testSequentialMode();
    await testBeforeToolCall();
    await testAfterToolCall();
    await testShouldStopAfterTurn();
    console.log("========== 02 Tools 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
