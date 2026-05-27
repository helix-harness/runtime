/**
 * Case: agentLoop AsyncGenerator (v0.4)
 *
 * 验证：
 * - agentLoop 返回 AsyncGenerator，可以 for await 迭代
 * - 事件顺序正确
 * - agent_end 包含所有新消息
 * - Agent.subscribe() 仍然正常工作（内部消费 generator）
 */

import { agentLoop, Agent } from "@helix/runtime";
import { createModel } from "./shared";
import type { AgentContext, AgentMessage } from "@helix/core";

async function testAgentLoopDirectly() {
  console.log("【1】直接使用 agentLoop AsyncGenerator\n");

  const context: AgentContext = {
    systemPrompt: "You are helpful. Reply concisely.",
    messages: [],
    tools: [],
  };

  const userMsg: AgentMessage = {
    role: "user",
    content: "Say exactly: 'Hello from agentLoop'",
    timestamp: Date.now(),
  };

  const eventTypes: string[] = [];
  let responseText = "";
  let agentEndMessages: AgentMessage[] = [];

  // for await — the key change in v0.4
  for await (const event of agentLoop([userMsg], context, {
    model: createModel(),
  })) {
    eventTypes.push(event.type);

    if (event.type === "message_update") {
      responseText += event.delta;
      process.stdout.write(event.delta);
    }

    if (event.type === "agent_end") {
      agentEndMessages = event.messages;
      // Accumulate manually (caller's responsibility with stateless loop)
      context.messages.push(userMsg, ...event.messages);
    }
  }

  console.log("\n");

  // Assertions
  console.assert(eventTypes[0] === "agent_start", "❌ first event must be agent_start");
  console.assert(eventTypes[eventTypes.length - 1] === "agent_end", "❌ last event must be agent_end");
  console.assert(eventTypes.includes("message_update"), "❌ missing message_update");
  console.assert(agentEndMessages.length > 0, "❌ agent_end.messages should not be empty");
  console.assert(context.messages.length > 0, "❌ context not updated");

  console.log(`  events: ${eventTypes.join(" → ")}`);
  console.log(`  context.messages: ${context.messages.length}`);
  console.log("✅ 直接使用 agentLoop 通过\n");
}

async function testAgentLoopMultiTurn() {
  console.log("【2】stateless agentLoop — 手动管理 context 多轮\n");

  const context: AgentContext = {
    systemPrompt: "You are helpful. Reply concisely.",
    messages: [],
    tools: [],
  };

  async function ask(input: string): Promise<string> {
    const userMsg: AgentMessage = { role: "user", content: input, timestamp: Date.now() };
    let reply = "";

    for await (const event of agentLoop([userMsg], context, {
      model: createModel(),
    })) {
      if (event.type === "message_update") reply += event.delta;
      if (event.type === "agent_end") {
        context.messages.push(userMsg, ...event.messages);
      }
    }
    return reply;
  }

  const r1 = await ask("My name is Robin.");
  console.log(`  turn 1: ${r1.trim().slice(0, 60)}...`);

  const r2 = await ask("What is my name?");
  console.log(`  turn 2: ${r2.trim().slice(0, 60)}...`);

  console.assert(context.messages.length >= 4, "❌ expected at least 4 messages");
  console.assert(
    r2.toLowerCase().includes("robin"),
    "❌ LLM should remember the name 'Robin'"
  );

  console.log("✅ stateless 多轮对话通过\n");
}

async function testAgentSubscribeStillWorks() {
  console.log("【3】Agent.subscribe() 仍然正常（内部消费 generator）\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are helpful.",
  });

  const eventTypes: string[] = [];
  const unsub = agent.subscribe((e) => eventTypes.push(e.type));

  let text = "";
  agent.subscribe((e) => {
    if (e.type === "message_update") text += e.delta;
  });

  await agent.prompt("Say exactly: 'subscribe works'");
  unsub();

  console.assert(eventTypes.includes("agent_start"), "❌ missing agent_start");
  console.assert(eventTypes.includes("agent_end"), "❌ missing agent_end");
  console.assert(agent.getMessages().length >= 2, "❌ messages not accumulated");

  console.log(`  response: ${text.trim().slice(0, 60)}`);
  console.log(`  messages: ${agent.getMessages().length}`);
  console.log("✅ Agent.subscribe() 通过\n");
}

export async function asyncGeneratorCase() {
  console.log("\n========== v0.4: agentLoop AsyncGenerator ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY not set — skipping");
    return;
  }

  try {
    await testAgentLoopDirectly();
    await testAgentLoopMultiTurn();
    await testAgentSubscribeStillWorks();
    console.log("========== v0.4 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
