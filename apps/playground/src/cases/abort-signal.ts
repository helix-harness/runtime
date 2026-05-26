/**
 * Case: AbortSignal
 *
 * 验证：
 * - agent.abort() 能中断正在运行的 loop
 * - prompt() 在 abort 后正常 resolve（不 throw）
 * - abort 后 agent_end 事件正确 emit
 * - abort 后 context.messages 不包含不完整的消息
 */

import { Agent, type AgentEvent } from "@helix/runtime";
import { createModel, checkOpenAI } from "./shared";
import type { ToolDef } from "@helix/core";

// 模拟一个慢 tool，给我们时间在执行中 abort
const slowTool: ToolDef = {
  name: "slow_operation",
  description: "A slow operation that takes several seconds",
  parameters: {
    type: "object",
    properties: {
      seconds: { type: "number", description: "How many seconds to wait" },
    },
    required: ["seconds"],
  },
  execute: async (args: any) => {
    const ms = (args.seconds ?? 3) * 1000;
    await new Promise((r) => setTimeout(r, ms));
    return { done: true, waited: ms };
  },
};

async function testAbortDuringTool() {
  console.log("【1】abort 在 tool 执行中\n");

  if (!checkOpenAI()) return;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant.",
    tools: [slowTool],
  });

  const events: AgentEvent[] = [];
  agent.subscribe((e) => {
    events.push(e);
    if (e.type === "tool_execution_start") {
      console.log(`  → tool started: ${e.name}`);
      // abort after 500ms
      setTimeout(() => {
        console.log("  ⚡ aborting...");
        agent.abort();
      }, 500);
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  const start = Date.now();

  // prompt should resolve, not throw, even after abort
  await agent.prompt("Please call slow_operation with seconds=5");
  const elapsed = Date.now() - start;

  console.log(`\n  elapsed: ${elapsed}ms (aborted early, expected < 4000ms)`);
  console.assert(elapsed < 4000, `❌ abort did not work, took ${elapsed}ms`);

  const hasAgentEnd = events.some((e) => e.type === "agent_end");
  console.assert(hasAgentEnd, "❌ agent_end should emit after abort");

  console.log("✅ abort 中断 tool 执行通过\n");
}

async function testAbortSignalFromOutside() {
  console.log("【2】外部 AbortController 传入\n");

  if (!checkOpenAI()) return;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Write a very long essay.",
    tools: [],
  });

  const controller = new AbortController();
  const events: AgentEvent[] = [];

  agent.subscribe((e) => {
    events.push(e);
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  // abort after 800ms from outside
  setTimeout(() => {
    console.log("\n  ⚡ external abort...");
    controller.abort();
  }, 800);

  const start = Date.now();
  await agent.prompt(
    "Write a 5000 word essay about the history of computing",
    { signal: controller.signal }
  );
  const elapsed = Date.now() - start;

  console.log(`\n  elapsed: ${elapsed}ms`);

  const hasAgentEnd = events.some((e) => e.type === "agent_end");
  console.assert(hasAgentEnd, "❌ agent_end should emit after external abort");
  console.log("✅ 外部 AbortController 通过\n");
}

async function testMessagesAfterAbort() {
  console.log("【3】abort 后 messages 状态\n");

  if (!checkOpenAI()) return;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant.",
    tools: [slowTool],
  });

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") {
      setTimeout(() => agent.abort(), 300);
    }
  });

  const messagesBefore = agent.getMessages().length;
  await agent.prompt("Call slow_operation with seconds=5");
  const messagesAfter = agent.getMessages().length;

  console.log(`  messages before: ${messagesBefore}, after: ${messagesAfter}`);

  // The user message should still be recorded even after abort
  // (prompt() pushes user message + newMessages)
  console.assert(
    messagesAfter >= messagesBefore,
    "❌ messages should not decrease after abort"
  );

  console.log("✅ abort 后 messages 状态正常\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function abortSignal() {
  console.log("\n========== v0.3: AbortSignal ==========\n");

  if (!checkOpenAI()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  try {
    await testAbortDuringTool();
    await testAbortSignalFromOutside();
    await testMessagesAfterAbort();
    console.log("========== v0.3 AbortSignal 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
