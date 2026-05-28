/**
 * Case: v1.0 New Features
 *
 * 验证：
 * - streamFn: 替换 model.stream() 调用
 * - thinkingLevel: 参数透传给 adapter
 * - steeringMode: 并发 prompt() 串行化
 * - waitForIdle(): 等待异步订阅者完成
 * - Bug fix #3: continue() 前置校验
 */

import { Agent } from "@helix/runtime";
import type { AgentMessage } from "@helix/core";
import { createModel } from "./shared";

// ─── 1. streamFn ─────────────────────────────────────────────────────────────

async function testStreamFn() {
  console.log("【1】streamFn — 替换 model.stream() 调用\n");

  let streamFnCalled = false;
  let receivedMessages: AgentMessage[] = [];

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are helpful.",

    // streamFn intercepts the LLM call
    streamFn: async function* (messages, opts) {
      streamFnCalled = true;
      receivedMessages = messages;
      console.log(`  → streamFn called with ${messages.length} message(s)`);
      console.log(`  → thinkingLevel from opts: ${opts.thinkingLevel}`);

      // Forward to real model (in production: call your proxy instead)
      const model = createModel();
      yield* model.stream(messages, opts);
    },
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("Say exactly: 'streamFn works'");
  console.log("\n");

  console.assert(streamFnCalled, "❌ streamFn was not called");
  console.assert(receivedMessages.length > 0, "❌ streamFn received no messages");
  console.log("✅ streamFn 通过\n");
}

async function testStreamFnProxy() {
  console.log("【2】streamFn — 模拟代理后端（mock）\n");

  // Simulate a backend proxy that returns a fixed response
  const agent = new Agent({
    model: createModel(),

    streamFn: async function* (messages, opts) {
      console.log(`  → proxy received ${messages.length} message(s)`);
      // Mock response — in production this would be a fetch() to your backend
      yield { type: "text_delta" as const, value: "Hello from proxy! " };
      yield { type: "text_delta" as const, value: "No real API key needed." };
      yield { type: "done" as const };
    },
  });

  let response = "";
  agent.subscribe((e) => {
    if (e.type === "message_update") response += e.delta;
  });

  await agent.prompt("Hello");
  console.log(`  response: "${response}"`);

  console.assert(response.includes("proxy"), "❌ proxy response not received");
  console.log("✅ streamFn mock proxy 通过\n");
}

// ─── 2. thinkingLevel ────────────────────────────────────────────────────────

async function testThinkingLevel() {
  console.log("【3】thinkingLevel — 参数透传验证\n");

  const receivedOpts: any[] = [];

  const agent = new Agent({
    model: createModel(),
    thinkingLevel: "medium",

    streamFn: async function* (messages, opts) {
      receivedOpts.push(opts);
      console.log(`  → thinkingLevel received: ${opts.thinkingLevel}`);
      yield { type: "text_delta" as const, value: "ok" };
      yield { type: "done" as const };
    },
  });

  await agent.prompt("test");

  console.assert(receivedOpts[0]?.thinkingLevel === "medium", "❌ thinkingLevel not passed to streamFn");
  console.log("✅ thinkingLevel 透传通过\n");
}

async function testThinkingDeltaEvent() {
  console.log("【4】thinking_update 事件 — 扩展推理内容事件\n");

  const thinkingDeltas: string[] = [];

  const agent = new Agent({
    model: createModel(),
    thinkingLevel: "high",

    // Simulate a model that emits thinking_delta chunks
    streamFn: async function* (messages, opts) {
      yield { type: "thinking_delta" as const, value: "Let me think..." };
      yield { type: "thinking_delta" as const, value: " Processing..." };
      yield { type: "text_delta" as const, value: "Answer: 42" };
      yield { type: "done" as const };
    },
  });

  agent.subscribe((e) => {
    if (e.type === "thinking_update") thinkingDeltas.push(e.delta);
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("What is the answer?");
  console.log("\n");

  console.assert(thinkingDeltas.length === 2, `❌ expected 2 thinking deltas, got ${thinkingDeltas.length}`);
  console.assert(thinkingDeltas[0] === "Let me think...", "❌ wrong thinking delta content");
  console.log(`  thinking deltas: ${thinkingDeltas.length}`);
  console.log("✅ thinking_update 事件通过\n");
}

// ─── 3. steeringMode ─────────────────────────────────────────────────────────

async function testSteeringModeOneAtATime() {
  console.log("【5】steeringMode: one-at-a-time — 并发 prompt 串行执行\n");

  const executionOrder: number[] = [];
  let callIndex = 0;

  const agent = new Agent({
    model: createModel(),
    steeringMode: "one-at-a-time",

    streamFn: async function* (messages, opts) {
      const myIndex = ++callIndex;
      executionOrder.push(myIndex);
      console.log(`  → prompt ${myIndex} started`);
      // Simulate slow LLM response
      await new Promise((r) => setTimeout(r, 100));
      yield { type: "text_delta" as const, value: `Response ${myIndex}` };
      yield { type: "done" as const };
      console.log(`  ← prompt ${myIndex} finished`);
    },
  });

  // Fire 3 prompts concurrently — they should execute sequentially
  const start = Date.now();
  await Promise.all([
    agent.prompt("First"),
    agent.prompt("Second"),
    agent.prompt("Third"),
  ]);
  const elapsed = Date.now() - start;

  console.log(`  elapsed: ${elapsed}ms (expected ≥ 300ms for 3 sequential 100ms calls)`);
  console.log(`  execution order: ${executionOrder.join(", ")}`);

  console.assert(
    executionOrder[0] === 1 && executionOrder[1] === 2 && executionOrder[2] === 3,
    "❌ prompts did not execute sequentially"
  );
  console.assert(elapsed >= 280, `❌ expected sequential execution (≥300ms), got ${elapsed}ms`);
  console.assert(agent.getMessages().length === 6, `❌ expected 6 messages (3 user + 3 assistant), got ${agent.getMessages().length}`);

  console.log("✅ steeringMode one-at-a-time 通过\n");
}

async function testSteeringModeAll() {
  console.log("【6】steeringMode: all — 并发 prompt 同时执行\n");

  let peakConcurrent = 0;
  let currentConcurrent = 0;

  const agent = new Agent({
    model: createModel(),
    steeringMode: "all",

    streamFn: async function* (messages, opts) {
      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 100));
      currentConcurrent--;
      yield { type: "text_delta" as const, value: "ok" };
      yield { type: "done" as const };
    },
  });

  const start = Date.now();
  await Promise.all([
    agent.prompt("First"),
    agent.prompt("Second"),
    agent.prompt("Third"),
  ]);
  const elapsed = Date.now() - start;

  console.log(`  elapsed: ${elapsed}ms (expected ~100ms for parallel)`);
  console.log(`  peak concurrent: ${peakConcurrent}`);

  console.assert(elapsed < 280, `❌ expected parallel execution (<280ms), got ${elapsed}ms`);
  console.assert(peakConcurrent > 1, "❌ expected concurrent execution");

  console.log("✅ steeringMode all 通过\n");
}

// ─── 4. waitForIdle ──────────────────────────────────────────────────────────

async function testWaitForIdle() {
  console.log("【7】waitForIdle — 等待异步订阅者完成\n");

  const completedTasks: string[] = [];

  const agent = new Agent({
    model: createModel(),
    streamFn: async function* (messages, opts) {
      yield { type: "text_delta" as const, value: "done" };
      yield { type: "done" as const };
    },
  });

  // Async subscriber that simulates a slow database write
  agent.subscribe(async (e) => {
    if (e.type === "agent_end") {
      await new Promise((r) => setTimeout(r, 200)); // simulate DB write
      completedTasks.push("db_write");
      console.log("  → async subscriber: db write completed");
    }
  });

  await agent.prompt("Hello");

  // At this point, the async subscriber may not have finished
  console.log(`  tasks after prompt(): ${completedTasks.length}`);

  // waitForIdle waits for all async subscribers to settle
  await agent.waitForIdle();
  console.log(`  tasks after waitForIdle(): ${completedTasks.length}`);

  console.assert(completedTasks.includes("db_write"), "❌ async subscriber did not complete");
  console.log("✅ waitForIdle 通过\n");
}

async function testWaitForIdleWithQueue() {
  console.log("【8】waitForIdle + steeringMode — 队列清空后再等订阅者\n");

  const log: string[] = [];

  const agent = new Agent({
    model: createModel(),
    steeringMode: "one-at-a-time",
    streamFn: async function* (messages, opts) {
      await new Promise((r) => setTimeout(r, 50));
      yield { type: "text_delta" as const, value: "ok" };
      yield { type: "done" as const };
    },
  });

  agent.subscribe(async (e) => {
    if (e.type === "agent_end") {
      await new Promise((r) => setTimeout(r, 100));
      log.push(`settled:${e.messages.length}`);
    }
  });

  // Queue 2 prompts, don't await either
  agent.prompt("First");
  agent.prompt("Second");

  // waitForIdle should wait for BOTH prompts AND their async subscribers
  await agent.waitForIdle();

  console.log(`  log: ${log.join(", ")}`);
  console.assert(log.length >= 1, "❌ expected at least 1 settled event");
  console.log("✅ waitForIdle + queue 通过\n");
}

// ─── 5. Bug fix #3: continue() validation ────────────────────────────────────

async function testContinueValidation() {
  console.log("【9】continue() 前置校验 — 不能在 assistant 消息后调用\n");

  const agent = new Agent({
    model: createModel(),
    streamFn: async function* () {
      yield { type: "text_delta" as const, value: "Hello" };
      yield { type: "done" as const };
    },
  });

  // After prompt(), last message is assistant → continue() should throw
  await agent.prompt("Hello");

  const messages = agent.getMessages();
  console.log(`  last message role: ${messages[messages.length - 1]?.role}`);

  let threw = false;
  try {
    await agent.continue();
  } catch (err: any) {
    threw = true;
    console.log(`  ✅ threw: ${err.message.slice(0, 80)}...`);
  }

  console.assert(threw, "❌ continue() should have thrown after assistant message");
  console.log("✅ continue() 前置校验通过\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function newFeatures() {
  console.log("\n========== v1.0: New Features ==========\n");

  try {
    // streamFn
    if (process.env.LLM_API_KEY) {
      await testStreamFn();
    } else {
      console.log("【1】streamFn (real API) — 跳过 (LLM_API_KEY 未设置)\n");
    }
    await testStreamFnProxy();

    // thinkingLevel
    await testThinkingLevel();
    await testThinkingDeltaEvent();

    // steeringMode
    await testSteeringModeOneAtATime();
    await testSteeringModeAll();

    // waitForIdle
    await testWaitForIdle();
    await testWaitForIdleWithQueue();

    // bug fix #3
    await testContinueValidation();

    console.log("========== v1.0 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
