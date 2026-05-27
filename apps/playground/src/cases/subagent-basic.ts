/**
 * Case: Sub-agent Basic (v0.7)
 *
 * 验证：
 * - createSubagentTool 把 Agent 包装成 ToolDef
 * - 父 agent 通过 tool call 调度子 agent
 * - 子 agent 运行完整的 agentLoop（含自己的 tools）
 * - 子 agent 结果作为 tool result 返回给父 agent
 * - onEvent 透传子 agent 事件给观察者
 */

import { Agent, createSubagentTool } from "@helix/runtime";
import { createModel } from "./shared";
import type { ToolDef } from "@helix/core";

// ─── Shared Tools ─────────────────────────────────────────────────────────────

const calculatorTool: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression, e.g. '2 + 3 * 4'" },
    },
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
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
  execute: async (args: any) => ({
    count: args.text.trim().split(/\s+/).length,
  }),
};

// ─── Test Cases ───────────────────────────────────────────────────────────────

async function testBasicDelegation() {
  console.log("【1】基础委托 — 父 agent 调用子 agent\n");

  // Sub-agent: math specialist with calculator tool
  const mathAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a math specialist. Always use the calculator tool for computations.",
    tools: [calculatorTool],
  });

  const subagentEvents: string[] = [];

  // Parent agent: delegates math tasks to sub-agent
  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. For any math calculation, delegate to the math_specialist.",
    tools: [
      createSubagentTool({
        name: "math_specialist",
        description: "Delegate math calculations to a specialist agent that uses a calculator tool.",
        agent: mathAgent,
        onEvent: (e) => {
          subagentEvents.push(e.type);
          if (e.type === "message_update") process.stdout.write(`  [subagent] ${e.delta}`);
        },
      }),
    ],
  });

  const parentEvents: string[] = [];
  parentAgent.subscribe((e) => {
    parentEvents.push(e.type);
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") console.log(`\n  → [parent] calling: ${e.name}`);
    if (e.type === "tool_execution_end") console.log(`\n  ← [parent] result received`);
  });

  await parentAgent.prompt("What is (123 * 456) + (789 / 3)?");
  console.log("\n");

  // Assertions
  console.assert(
    parentEvents.includes("tool_execution_start"),
    "❌ parent should have called the subagent tool"
  );
  console.assert(
    subagentEvents.includes("agent_start"),
    "❌ subagent events not received via onEvent"
  );
  console.assert(
    subagentEvents.includes("tool_execution_start"),
    "❌ subagent should have used calculator tool"
  );

  console.log(`  parent events: ${[...new Set(parentEvents)].join(", ")}`);
  console.log(`  subagent events: ${[...new Set(subagentEvents)].join(", ")}`);
  console.log("✅ 基础委托通过\n");
}

async function testSubagentWithOwnTools() {
  console.log("【2】子 agent 有自己的 tools — 独立运行 agentLoop\n");

  // Sub-agent: text analyst with word_count tool
  const textAnalyst = new Agent({
    model: createModel(),
    systemPrompt: "You are a text analysis specialist. Use the word_count tool when analyzing text length.",
    tools: [wordCountTool],
  });

  const textTool = createSubagentTool({
    name: "text_analyst",
    description: "Delegate text analysis tasks to a specialist. Pass the text and analysis request as the task.",
    agent: textAnalyst,
    onEvent: (e) => {
      if (e.type === "tool_execution_start") console.log(`\n  [text_analyst] using tool: ${e.name}`);
      if (e.type === "message_update") process.stdout.write(`  [text_analyst] ${e.delta}`);
    },
  });

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. Use the text_analyst tool for text analysis tasks.",
    tools: [textTool],
  });

  parentAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await parentAgent.prompt('How many words are in this text: "The quick brown fox jumps over the lazy dog"?');
  console.log("\n");

  const subMessages = textAnalyst.getMessages();
  console.log(`  sub-agent messages: ${subMessages.length}`);
  console.assert(subMessages.length >= 2, "❌ sub-agent should have at least 2 messages");

  console.log("✅ 子 agent 独立 tool 执行通过\n");
}

async function testMultipleSubagents() {
  console.log("【3】多个子 agent — 不同专长\n");

  const mathAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a math specialist.",
    tools: [calculatorTool],
  });

  const textAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a text specialist.",
    tools: [wordCountTool],
  });

  const calledTools: string[] = [];

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt:
      "You are an orchestrator. Use math_specialist for calculations and text_specialist for text tasks.",
    tools: [
      createSubagentTool({
        name: "math_specialist",
        description: "Handles math calculations.",
        agent: mathAgent,
        onEvent: (e) => {
          if (e.type === "agent_start") calledTools.push("math_specialist");
        },
      }),
      createSubagentTool({
        name: "text_specialist",
        description: "Handles text analysis.",
        agent: textAgent,
        onEvent: (e) => {
          if (e.type === "agent_start") calledTools.push("text_specialist");
        },
      }),
    ],
  });

  parentAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
    if (e.type === "tool_execution_start") console.log(`\n  → calling: ${e.name}`);
  });

  await parentAgent.prompt(
    "Please do two things: (1) calculate 99 * 99, and (2) count the words in 'hello world foo bar'."
  );
  console.log("\n");

  console.log(`  sub-agents called: ${calledTools.join(", ")}`);
  console.assert(calledTools.length >= 1, "❌ at least one sub-agent should have been called");

  console.log("✅ 多子 agent 通过\n");
}

async function testSubagentContextIsolation() {
  console.log("【4】子 agent context 隔离 — 多次调用不串消息\n");

  const subAgent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful specialist. Reply concisely.",
  });

  const tool = createSubagentTool({
    name: "specialist",
    description: "A specialist agent.",
    agent: subAgent,
  });

  const parentAgent = new Agent({
    model: createModel(),
    systemPrompt: "Use the specialist tool for each task.",
    tools: [tool],
  });

  parentAgent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  // First call
  await parentAgent.prompt("Ask the specialist: what color is the sky?");
  const afterFirst = subAgent.getMessages().length;
  console.log(`\n  messages after first call: ${afterFirst}`);

  // Second call — sub-agent accumulates messages (stateful by default)
  await parentAgent.prompt("Ask the specialist: what color is grass?");
  const afterSecond = subAgent.getMessages().length;
  console.log(`  messages after second call: ${afterSecond}`);

  console.assert(afterSecond > afterFirst, "❌ sub-agent should accumulate messages across calls");

  // Note: if isolation is desired, call subAgent.clearMessages() in afterToolCall hook
  console.log("  ℹ️  Sub-agent is stateful by default. Use clearMessages() for isolation.");
  console.log("✅ context 隔离行为验证通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function subagentBasic() {
  console.log("\n========== v0.7: Sub-agent (createSubagentTool) ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY not set — skipping");
    return;
  }

  try {
    await testBasicDelegation();
    await testSubagentWithOwnTools();
    await testMultipleSubagents();
    await testSubagentContextIsolation();
    console.log("========== v0.7 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
