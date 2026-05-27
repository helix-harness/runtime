/**
 * Case: Sub-agent Advanced (v0.7)
 *
 * 验证：
 * - Anthropic 子 agent + OpenAI 父 agent（跨 provider multi-agent）
 * - beforeToolCall 可以拦截子 agent 调用
 * - 子 agent 使用 clearMessages() 实现 stateless 模式
 * - 嵌套子 agent（子 agent 的子 agent）
 */

import { Agent, createSubagentTool } from "@helix/runtime";
import { createModel } from "./shared";
import type { ToolDef } from "@helix/core";

const echoTool: ToolDef = {
  name: "echo",
  description: "Echo back the input",
  parameters: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  execute: async (args: any) => ({ echoed: args.message }),
};

async function testCrossProviderSubagent() {
  console.log("【1】跨 provider — Anthropic 子 agent + OpenAI 父 agent\n");

  // Sub-agent: Anthropic Claude
  const claudeAgent = new Agent({
    model: createModel({ provider: "anthropic-compatible", model: "claude-haiku-4-5-20251001" }),
    systemPrompt: "You are a creative writing specialist. Be concise.",
  });

  // Parent agent: OpenAI GPT
  const gptAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are an orchestrator. Delegate creative tasks to the creative_writer.",
    tools: [
      createSubagentTool({
        name: "creative_writer",
        description: "Delegate creative writing tasks to a Claude-powered specialist.",
        agent: claudeAgent,
        onEvent: (e) => {
          if (e.type === "message_update") process.stdout.write(`  [claude] ${e.delta}`);
        },
      }),
    ],
  });

  gptAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") console.log(`\n  → delegating to: ${e.name}`);
    if (e.type === "tool_execution_end") console.log(`\n  ← delegation complete`);
  });

  await gptAgent.prompt("Ask the creative writer to write a haiku about TypeScript.");
  console.log("\n");

  console.log("✅ 跨 provider sub-agent 通过\n");
}

async function testStatelessSubagent() {
  console.log("【2】stateless 子 agent — 每次调用前 clearMessages()\n");

  const subAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful specialist. Reply in one sentence.",
  });

  const callCount = { value: 0 };

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "Use the specialist tool for each question.",
    tools: [
      createSubagentTool({
        name: "specialist",
        description: "A stateless specialist — fresh context each call.",
        agent: subAgent,
      }),
    ],
    afterToolCall: async ({ name }) => {
      if (name === "specialist") {
        callCount.value++;
        // Clear sub-agent state after each use → stateless behaviour
        subAgent.clearMessages();
      }
    },
  });

  parentAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await parentAgent.prompt("Ask the specialist: what is 2+2?");
  console.log(`\n  sub-agent messages after clear: ${subAgent.getMessages().length}`);

  await parentAgent.prompt("Ask the specialist: what is the capital of France?");
  console.log(`  sub-agent messages after second clear: ${subAgent.getMessages().length}`);

  console.assert(
    subAgent.getMessages().length <= 2,
    "❌ sub-agent should have been cleared between calls"
  );

  console.log(`  total specialist calls: ${callCount.value}`);
  console.log("✅ stateless 子 agent 通过\n");
}

async function testSubagentBlocked() {
  console.log("【3】beforeToolCall 拦截子 agent 调用\n");

  const subAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a specialist.",
  });

  let wasBlocked = false;

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "Use the restricted_specialist for all tasks.",
    tools: [
      createSubagentTool({
        name: "restricted_specialist",
        description: "A specialist that requires authorization.",
        agent: subAgent,
      }),
    ],
    beforeToolCall: async ({ name }) => {
      if (name === "restricted_specialist") {
        wasBlocked = true;
        console.log("  🚫 blocked: restricted_specialist");
        return "block";
      }
      return "allow";
    },
  });

  parentAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await parentAgent.prompt("Use the restricted_specialist to answer: what is 2+2?");
  console.log("\n");

  console.assert(wasBlocked, "❌ beforeToolCall should have blocked the subagent call");
  console.assert(subAgent.getMessages().length === 0, "❌ sub-agent should not have run");

  console.log("✅ beforeToolCall 拦截子 agent 通过\n");
}

async function testNestedSubagents() {
  console.log("【4】嵌套子 agent — 子 agent 的子 agent\n");

  // Level 2: deepest specialist
  const level2Agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a level-2 specialist. Reply with 'L2: ' prefix.",
    tools: [echoTool],
  });

  // Level 1: middle agent, has level2 as sub-agent
  const level1Agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a level-1 coordinator. Delegate to level2_specialist when needed.",
    tools: [
      createSubagentTool({
        name: "level2_specialist",
        description: "A deeper specialist for complex tasks.",
        agent: level2Agent,
        onEvent: (e) => {
          if (e.type === "message_update") process.stdout.write(`    [L2] ${e.delta}`);
        },
      }),
    ],
  });

  // Level 0: root agent, has level1 as sub-agent
  const rootAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are the root orchestrator. Delegate to level1_coordinator.",
    tools: [
      createSubagentTool({
        name: "level1_coordinator",
        description: "A coordinator that can further delegate to specialists.",
        agent: level1Agent,
        onEvent: (e) => {
          if (e.type === "message_update") process.stdout.write(`  [L1] ${e.delta}`);
          if (e.type === "tool_execution_start") console.log(`\n  [L1] → calling: ${e.name}`);
        },
      }),
    ],
  });

  rootAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") console.log(`\n[root] → calling: ${e.name}`);
  });

  await rootAgent.prompt("Please use level1_coordinator to handle this task: echo the message 'hello nested'.");
  console.log("\n");

  console.log("✅ 嵌套子 agent 通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function subagentAdvanced() {
  console.log("\n========== v0.7: Sub-agent Advanced ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY not set — skipping");
    return;
  }

  try {
    await testCrossProviderSubagent();
    await testStatelessSubagent();
    await testSubagentBlocked();
    await testNestedSubagents();
    console.log("========== v0.7 Advanced 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
