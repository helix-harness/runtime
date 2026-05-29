/**
 * Case 01: Basics — Model + Agent 入门
 *
 * 覆盖：
 *  1) Model 流式调用（不经过 Agent）
 *  2) Agent 基础对话（单轮）
 *  3) Agent 多轮累积（messages 自动累积）
 *  4) 事件序列断言（agent_start → turn_start → message_* → turn_end → agent_end）
 *  5) agentLoop 低层使用（stateless，手动管理 context）
 */

import { Agent, agentLoop, type AgentEvent } from "@helix/runtime";
import type { AgentContext, AgentMessage } from "@helix/core";
import { createModel, checkEnv } from "./shared";

// ─── 1) Model 流式 ────────────────────────────────────────────────────────────

async function testModelStream() {
  console.log("【1】Model 流式调用 — 不经过 Agent\n");

  const model = createModel();
  const messages: AgentMessage[] = [
    { role: "user", content: "1+1=? 只回答数字", timestamp: Date.now() },
  ];

  process.stdout.write("  → ");
  let text = "";
  for await (const chunk of model.stream(messages, {})) {
    if (chunk.type === "text_delta") {
      text += chunk.value;
      process.stdout.write(chunk.value);
    }
  }
  console.log("\n");

  console.assert(text.length > 0, "❌ model.stream 未输出任何文本");
  console.log("✅ Model 流式通过\n");
}

// ─── 2) Agent 基础对话 ───────────────────────────────────────────────────────

async function testAgentBasic() {
  console.log("【2】Agent 基础对话 — 单轮\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手，回答尽量简短。",
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  process.stdout.write("  → ");
  await agent.prompt("用一句话介绍你自己");
  console.log("\n");

  const messages = agent.getMessages();
  console.assert(messages.length >= 2, "❌ Agent 应至少累积 user + assistant 两条消息");
  console.log(`  messages: ${messages.length}`);
  console.log("✅ Agent 基础对话通过\n");
}

// ─── 3) Agent 多轮累积 ───────────────────────────────────────────────────────

async function testMultiTurn() {
  console.log("【3】多轮对话 — messages 自动累积\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。回答控制在 20 字以内。",
  });

  await agent.prompt("我叫小明");
  const after1 = agent.getMessages().length;

  await agent.prompt("我叫什么名字？");
  const after2 = agent.getMessages().length;

  console.log(`  第 1 轮后 messages: ${after1}`);
  console.log(`  第 2 轮后 messages: ${after2}`);

  console.assert(after1 >= 2, "❌ 第 1 轮应至少 2 条消息");
  console.assert(after2 > after1, "❌ 第 2 轮消息数应增加");

  const lastReply = agent.getMessages().at(-1)?.content ?? "";
  console.log(`  LLM 回答: ${lastReply.slice(0, 60)}`);
  console.assert(lastReply.toLowerCase().includes("小明"), "❌ LLM 应能记住上轮名字");

  console.log("✅ 多轮累积通过\n");
}

// ─── 4) 事件序列断言 ─────────────────────────────────────────────────────────

async function testEventSequence() {
  console.log("【4】事件序列 — agent_start → ... → agent_end\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
  });

  const events: AgentEvent["type"][] = [];
  agent.subscribe((e) => {
    events.push(e.type);
  });

  await agent.prompt("1+1 等于几？只回答数字。");

  console.log(`  序列: ${events.join(" → ")}`);

  const start = events.indexOf("agent_start");
  const turnStart = events.indexOf("turn_start");
  const messageStart = events.indexOf("message_start");
  const messageEnd = events.indexOf("message_end");
  const turnEnd = events.indexOf("turn_end");
  const end = events.indexOf("agent_end");

  console.assert(start === 0, "❌ agent_start 必须是首个事件");
  console.assert(end === events.length - 1, "❌ agent_end 必须是末尾事件");
  console.assert(start < turnStart, "❌ agent_start < turn_start");
  console.assert(turnStart < messageStart, "❌ turn_start < message_start");
  console.assert(messageStart < messageEnd, "❌ message_start < message_end");
  console.assert(messageEnd < turnEnd, "❌ message_end < turn_end");
  console.assert(turnEnd < end, "❌ turn_end < agent_end");

  console.log("✅ 事件序列通过\n");
}

// ─── 5) agentLoop 低层使用 ──────────────────────────────────────────────────

async function testAgentLoopLowLevel() {
  console.log("【5】agentLoop 低层 — stateless，调用方管理 context\n");

  const context: AgentContext = {
    systemPrompt: "你是一个简洁的助手。",
    messages: [],
    tools: [],
  };

  const userMsg: AgentMessage = {
    role: "user",
    content: "请只回答：hello",
    timestamp: Date.now(),
  };

  const types: string[] = [];
  let reply = "";

  for await (const event of agentLoop([userMsg], context, { model: createModel() })) {
    types.push(event.type);
    if (event.type === "message_update") reply += event.delta;
    if (event.type === "agent_end") {
      // 调用方负责把新消息合并到 context（stateless 的关键约定）
      context.messages.push(userMsg, ...event.messages);
    }
  }

  console.log(`  reply: ${reply.trim().slice(0, 60)}`);
  console.log(`  context.messages: ${context.messages.length}`);
  console.assert(types[0] === "agent_start", "❌ 首事件应为 agent_start");
  console.assert(types.at(-1) === "agent_end", "❌ 末事件应为 agent_end");
  console.assert(context.messages.length >= 2, "❌ context 应至少含 user + assistant");

  console.log("✅ agentLoop 低层通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function basics() {
  console.log("\n========== 01 Basics: Model + Agent 入门 ==========\n");

  if (!checkEnv()) {
    console.log("跳过\n");
    return;
  }

  try {
    await testModelStream();
    await testAgentBasic();
    await testMultiTurn();
    await testEventSequence();
    await testAgentLoopLowLevel();
    console.log("========== 01 Basics 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
