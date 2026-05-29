/**
 * Case 05: Sub-agent — Multi-agent 协作
 *
 * 覆盖：
 *  1) 基础委托 — 父 agent 通过 tool 调度子 agent
 *  2) 子 agent 拥有自己的 tools，独立跑 agentLoop
 *  3) 多个专家子 agent — 不同专长协作
 *  4) Sub-agent context 隔离行为
 *
 * 关键 API：createSubagentTool({ name, description, agent, onEvent })
 */

import { Agent, createSubagentTool } from "@helix/runtime";
import type { ToolDef } from "@helix/core";
import { createModel, checkEnv } from "./shared";

// ─── Shared tools for sub-agents ────────────────────────────────────────────

const calculatorTool: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression",
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

const wordCountTool: ToolDef = {
  name: "word_count",
  description: "Count words in a text",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute: async (args: any) => ({
    count: args.text.trim().split(/\s+/).length,
  }),
};

// ─── 1) 基础委托 ─────────────────────────────────────────────────────────────

async function testBasicDelegation() {
  console.log("【1】基础委托 — 父 agent → math 专家子 agent\n");

  const mathAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a math specialist. Always use the calculator tool.",
    tools: [calculatorTool],
  });

  const subEvents: string[] = [];

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are an assistant. Delegate math tasks to math_specialist.",
    tools: [
      createSubagentTool({
        name: "math_specialist",
        description: "Delegate math calculations to a specialist.",
        agent: mathAgent,
        onEvent: (e) => {
          subEvents.push(e.type);
          if (e.type === "message_update") process.stdout.write(`  [sub] ${e.delta}`);
        },
      }),
    ],
  });

  const parentEvents: string[] = [];
  parentAgent.subscribe((e) => {
    parentEvents.push(e.type);
    if (e.type === "tool_execution_start") console.log(`\n  → [parent] ${e.name}`);
    if (e.type === "tool_execution_end") console.log(`  ← [parent] done`);
  });

  await parentAgent.prompt("What is (123 * 456) + (789 / 3)?");
  console.log();

  console.assert(parentEvents.includes("tool_execution_start"), "❌ 父未调用子 agent tool");
  console.assert(subEvents.includes("agent_start"), "❌ onEvent 未收到子 agent 事件");
  console.assert(subEvents.includes("tool_execution_start"), "❌ 子 agent 未用 calculator");
  console.log("✅ 基础委托通过\n");
}

// ─── 2) 子 agent 独立 tool 执行 ─────────────────────────────────────────────

async function testSubagentWithOwnTools() {
  console.log("【2】子 agent 独立运行 agentLoop（含自己 tools）\n");

  const textAnalyst = new Agent({
    model: createModel(),
    systemPrompt: "You analyze text. Use word_count when asked about length.",
    tools: [wordCountTool],
  });

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "Use text_analyst for text analysis.",
    tools: [
      createSubagentTool({
        name: "text_analyst",
        description: "Delegate text analysis.",
        agent: textAnalyst,
        onEvent: (e) => {
          if (e.type === "tool_execution_start") console.log(`  [sub] using: ${e.name}`);
        },
      }),
    ],
  });

  await parentAgent.prompt('How many words: "The quick brown fox jumps over the lazy dog"?');
  console.log();

  const subMessages = textAnalyst.getMessages();
  console.log(`  sub-agent messages: ${subMessages.length}`);
  console.assert(subMessages.length >= 2, "❌ 子 agent 应至少 2 条消息");
  console.log("✅ 子 agent 独立运行通过\n");
}

// ─── 3) 多专家协作 ──────────────────────────────────────────────────────────

async function testMultiSpecialists() {
  console.log("【3】多专家协作 — math + text\n");

  const mathAgent = new Agent({
    model: createModel(),
    systemPrompt: "Math specialist.",
    tools: [calculatorTool],
  });

  const textAgent = new Agent({
    model: createModel(),
    systemPrompt: "Text specialist.",
    tools: [wordCountTool],
  });

  const called: string[] = [];

  const orchestrator = new Agent({
    model: createModel(),
    systemPrompt:
      "Orchestrator. Use math_specialist for math, text_specialist for text.",
    tools: [
      createSubagentTool({
        name: "math_specialist",
        description: "Math calculations.",
        agent: mathAgent,
        onEvent: (e) => {
          if (e.type === "agent_start") called.push("math");
        },
      }),
      createSubagentTool({
        name: "text_specialist",
        description: "Text analysis.",
        agent: textAgent,
        onEvent: (e) => {
          if (e.type === "agent_start") called.push("text");
        },
      }),
    ],
  });

  orchestrator.subscribe((e) => {
    if (e.type === "tool_execution_start") console.log(`  → ${e.name}`);
  });

  await orchestrator.prompt(
    "Do two things: (1) calculate 99 * 99, (2) count words in 'hello world foo bar'."
  );
  console.log();

  console.log(`  called: ${called.join(", ")}`);
  console.assert(called.length >= 1, "❌ 至少应有一个专家被调用");
  console.log("✅ 多专家协作通过\n");
}

// ─── 4) Context 隔离行为 ────────────────────────────────────────────────────

async function testContextBehavior() {
  console.log("【4】Sub-agent context — 默认是有状态累积\n");

  const sub = new Agent({
    model: createModel(),
    systemPrompt: "Reply concisely.",
  });

  const parent = new Agent({
    model: createModel(),
    systemPrompt: "Use the specialist for each task.",
    tools: [
      createSubagentTool({
        name: "specialist",
        description: "A specialist.",
        agent: sub,
      }),
    ],
  });

  await parent.prompt("Ask specialist: what color is the sky?");
  const after1 = sub.getMessages().length;
  console.log(`  第 1 次后 sub messages: ${after1}`);

  await parent.prompt("Ask specialist: what color is grass?");
  const after2 = sub.getMessages().length;
  console.log(`  第 2 次后 sub messages: ${after2}`);

  console.assert(after2 > after1, "❌ sub-agent 默认应累积消息");
  console.log("  ℹ️  如需隔离，可在 afterToolCall 中调 sub.clearMessages()");
  console.log("✅ Context 行为验证通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function subagent() {
  console.log("\n========== 05 Sub-agent: Multi-agent 协作 ==========\n");

  if (!checkEnv()) {
    console.log("跳过\n");
    return;
  }

  try {
    await testBasicDelegation();
    await testSubagentWithOwnTools();
    await testMultiSpecialists();
    await testContextBehavior();
    console.log("========== 05 Sub-agent 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
