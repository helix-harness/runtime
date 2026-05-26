/**
 * Case: Tool Hooks
 *
 * 验证：
 * - beforeToolCall 返回 "block" 能阻断 tool 执行
 * - afterToolCall 在每次 tool 执行后被调用
 * - shouldStopAfterTurn 能提前终止 loop
 */

import { Agent } from "@helix/runtime";
import { createModel, checkOpenAI } from "./shared";
import type { ToolDef } from "@helix/core";

// ─── Shared Tools ─────────────────────────────────────────────────────────────

const safeToolDef: ToolDef = {
  name: "safe_tool",
  description: "安全的 tool，可以正常执行",
  parameters: {
    type: "object",
    properties: { message: { type: "string" } },
  },
  execute: async (args: any) => ({ echo: args.message }),
};

const dangerousToolDef: ToolDef = {
  name: "dangerous_tool",
  description: "危险的 tool，会被 beforeToolCall 拦截",
  parameters: {
    type: "object",
    properties: { action: { type: "string" } },
  },
  execute: async (args: any) => {
    // 如果 beforeToolCall 正常工作，这里永远不会被执行
    return { executed: true, action: args.action };
  },
};

function makeAgent(overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
  if (!checkOpenAI()) throw new Error("OPENAI_API_KEY not set");
  return new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Use tools when asked.",
    tools: [safeToolDef, dangerousToolDef],
    ...overrides,
  });
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

async function testBeforeToolCallBlock() {
  console.log("【1】beforeToolCall — 拦截 dangerous_tool\n");

  const blocked: string[] = [];
  const executed: string[] = [];

  const agent = makeAgent({
    beforeToolCall: async ({ name }) => {
      if (name === "dangerous_tool") {
        blocked.push(name);
        console.log(`  🚫 blocked: ${name}`);
        return "block";
      }
      return "allow";
    },
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") executed.push(e.name);
  });

  await agent.prompt("请调用 dangerous_tool，action 传 'delete everything'");
  console.log("\n");

  console.assert(blocked.includes("dangerous_tool"), "❌ dangerous_tool was not blocked");
  console.assert(!executed.includes("dangerous_tool"), "❌ dangerous_tool should not have executed");
  console.log("✅ beforeToolCall 拦截通过\n");
}

async function testBeforeToolCallAllow() {
  console.log("【2】beforeToolCall — 允许 safe_tool\n");

  const executed: string[] = [];

  const agent = makeAgent({
    beforeToolCall: async ({ name }): Promise<"block" | "allow"> => {
      console.log(`  ✅ allowing: ${name}`);
      return "allow";
    },
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") executed.push(e.name);
  });

  await agent.prompt("请调用 safe_tool，message 传 'hello'");
  console.log("\n");

  console.assert(executed.includes("safe_tool"), "❌ safe_tool was not executed");
  console.log("✅ beforeToolCall 允许通过\n");
}

async function testAfterToolCall() {
  console.log("【3】afterToolCall — 记录所有 tool 执行\n");

  const log: Array<{ name: string; isError: boolean }> = [];

  const agent = makeAgent({
    tools: [safeToolDef],
    beforeToolCall: async ({ name }): Promise<"block" | "allow"> => {
      console.log(`  ✅ allowing: ${name}`);
      return "allow";
    },
    afterToolCall: async ({ name, result, isError }) => {
      log.push({ name, isError });
      console.log(`  📝 afterToolCall: ${name} isError=${isError}`);
    },
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("请调用 safe_tool，message 传 'test afterToolCall'");
  console.log("\n");

  console.assert(log.length > 0, "❌ afterToolCall was never called");
  console.assert(log[0]!.name === "safe_tool", "❌ wrong tool name in afterToolCall");
  console.assert(!log[0]!.isError, "❌ safe_tool should not be an error");
  console.log("✅ afterToolCall 通过\n");
}

async function testShouldStopAfterTurn() {
  console.log("【4】shouldStopAfterTurn — 限制最多 1 轮 tool 调用\n");

  let turnCount = 0;

  const infiniteLoopTool: ToolDef = {
    name: "continue_tool",
    description: "Returns a message asking to call itself again",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ message: "Please call continue_tool again" }),
  };

  const agent = makeAgent({
    tools: [infiniteLoopTool],
    shouldStopAfterTurn: async ({ toolResults }) => {
      turnCount++;
      console.log(`  turn ${turnCount} done, toolResults: ${toolResults.length}`);
      // 强制最多 2 轮
      return turnCount >= 2;
    },
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("请不停地调用 continue_tool");
  console.log("\n");

  console.assert(turnCount <= 2, `❌ should have stopped at 2 turns, got ${turnCount}`);
  console.log(`  stopped at turn ${turnCount}`);
  console.log("✅ shouldStopAfterTurn 通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function toolHooks() {
  console.log("\n========== v0.3: Tool Hooks ==========\n");

  if (!checkOpenAI()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  try {
    await testBeforeToolCallBlock();
    await testBeforeToolCallAllow();
    await testAfterToolCall();
    await testShouldStopAfterTurn();
    console.log("========== v0.3 Hooks 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
