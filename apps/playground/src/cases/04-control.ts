/**
 * Case 04: Control — 运行流程控制
 *
 * 覆盖：
 *  1) AbortSignal — agent.abort() / 外部 AbortController
 *  2) steeringMode: one-at-a-time — 并发 prompt 串行化
 *  3) steeringMode: all — 并发 prompt 同时执行
 *  4) waitForIdle — 等待异步订阅者完成
 *  5) continue() 校验 — assistant 消息后不允许 continue
 *  6) streamFn — 替换 model.stream（用于代理后端 / mock）
 *  7) thinkingLevel + thinking_update 事件
 *
 * 说明：6/7 使用 mock streamFn，不需要真实 API key 也能跑。
 */

import { Agent, type AgentEvent } from "@helix/runtime";
import type { ToolDef, AgentMessage } from "@helix/core";
import { createModel, checkEnv } from "./shared";

// ─── 1) AbortSignal ─────────────────────────────────────────────────────────

const slowTool: ToolDef = {
  name: "slow_operation",
  description: "A slow operation",
  parameters: {
    type: "object",
    properties: { seconds: { type: "number" } },
    required: ["seconds"],
  },
  execute: async (args: any) => {
    await new Promise((r) => setTimeout(r, (args.seconds ?? 3) * 1000));
    return { done: true };
  },
};

// abort 触发时，底层 LLM SDK 通常会抛 user-abort 错误。
// 这里把所有名字含 "abort" 的错误视为预期。
function isAbortError(err: unknown): boolean {
  const msg = (err as any)?.message ?? "";
  const name = (err as any)?.name ?? "";
  return /abort/i.test(msg) || /abort/i.test(name);
}

async function testAbortDuringTool() {
  console.log("【1】AbortSignal — agent.abort() 在 LLM/tool 执行中\n");

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
    }
  });

  // 500ms 后无差别 abort（无论此时在 LLM 还是 tool 阶段都能中断）
  setTimeout(() => {
    console.log("  ⚡ abort()");
    agent.abort();
  }, 500);

  const start = Date.now();
  try {
    await agent.prompt("请调用 slow_operation，seconds=5");
  } catch (err) {
    console.assert(isAbortError(err), `❌ 期望 abort error，实际: ${(err as any)?.message}`);
    console.log(`  caught abort error: ${(err as any)?.name ?? "Error"}`);
  }
  const elapsed = Date.now() - start;
  console.log(`  elapsed: ${elapsed}ms`);

  console.assert(elapsed < 4000, `❌ abort 应在 4s 内结束，实际 ${elapsed}ms`);
  console.log("✅ AbortSignal (abort) 通过\n");
}

async function testExternalAbortController() {
  console.log("【2】外部 AbortController — 通过 signal 参数\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are helpful.",
  });

  const ctl = new AbortController();
  setTimeout(() => {
    console.log("\n  ⚡ external abort");
    ctl.abort();
  }, 800);

  const start = Date.now();
  try {
    await agent.prompt("Write a 5000 word essay about computing history", {
      signal: ctl.signal,
    });
  } catch (err) {
    console.assert(isAbortError(err), `❌ 期望 abort error，实际: ${(err as any)?.message}`);
    console.log(`  caught abort error: ${(err as any)?.name ?? "Error"}`);
  }
  const elapsed = Date.now() - start;
  console.log(`  elapsed: ${elapsed}ms`);
  console.assert(elapsed < 4000, `❌ 应在 4s 内被外部 abort，实际 ${elapsed}ms`);
  console.log("✅ 外部 AbortController 通过\n");
}

// ─── 2) steeringMode: one-at-a-time ─────────────────────────────────────────

async function testSteeringOneAtATime() {
  console.log("【3】steeringMode: one-at-a-time — 并发 prompt 串行化\n");

  const order: number[] = [];
  let idx = 0;

  const agent = new Agent({
    model: createModel(),
    steeringMode: "one-at-a-time",
    streamFn: async function* () {
      const i = ++idx;
      order.push(i);
      console.log(`  → prompt ${i} start`);
      await new Promise((r) => setTimeout(r, 100));
      yield { type: "text_delta" as const, value: `r${i}` };
      yield { type: "done" as const };
      console.log(`  ← prompt ${i} done`);
    },
  });

  const start = Date.now();
  await Promise.all([
    agent.prompt("First"),
    agent.prompt("Second"),
    agent.prompt("Third"),
  ]);
  const elapsed = Date.now() - start;

  console.log(`  elapsed: ${elapsed}ms (≥ 300ms for serial)`);
  console.log(`  order: ${order.join(", ")}`);
  console.assert(order[0] === 1 && order[1] === 2 && order[2] === 3, "❌ 顺序错误");
  console.assert(elapsed >= 280, `❌ 应串行 ≥300ms，实际 ${elapsed}ms`);
  console.log("✅ one-at-a-time 通过\n");
}

// ─── 3) steeringMode: all ───────────────────────────────────────────────────

async function testSteeringAll() {
  console.log("【4】steeringMode: all — 并发 prompt 同时执行\n");

  let peak = 0;
  let current = 0;

  const agent = new Agent({
    model: createModel(),
    steeringMode: "all",
    streamFn: async function* () {
      current++;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 100));
      current--;
      yield { type: "text_delta" as const, value: "ok" };
      yield { type: "done" as const };
    },
  });

  const start = Date.now();
  await Promise.all([
    agent.prompt("A"),
    agent.prompt("B"),
    agent.prompt("C"),
  ]);
  const elapsed = Date.now() - start;

  console.log(`  elapsed: ${elapsed}ms (~100ms for parallel)`);
  console.log(`  peak concurrent: ${peak}`);
  console.assert(elapsed < 280, `❌ 应并行 <280ms，实际 ${elapsed}ms`);
  console.assert(peak > 1, "❌ 应同时执行");
  console.log("✅ steeringMode all 通过\n");
}

// ─── 4) waitForIdle ─────────────────────────────────────────────────────────

async function testWaitForIdle() {
  console.log("【5】waitForIdle — 等异步订阅者完成\n");

  const tasks: string[] = [];

  const agent = new Agent({
    model: createModel(),
    streamFn: async function* () {
      yield { type: "text_delta" as const, value: "done" };
      yield { type: "done" as const };
    },
  });

  agent.subscribe(async (e) => {
    if (e.type === "agent_end") {
      await new Promise((r) => setTimeout(r, 200)); // 模拟 DB 写入
      tasks.push("db_write");
      console.log("  → async subscriber: db_write");
    }
  });

  await agent.prompt("Hello");
  console.log(`  tasks 完成数（prompt 后）: ${tasks.length}`);

  await agent.waitForIdle();
  console.log(`  tasks 完成数（waitForIdle 后）: ${tasks.length}`);

  console.assert(tasks.includes("db_write"), "❌ 异步订阅者未完成");
  console.log("✅ waitForIdle 通过\n");
}

// ─── 5) continue() 校验 ─────────────────────────────────────────────────────

async function testContinueValidation() {
  console.log("【6】continue() 校验 — assistant 后不能 continue\n");

  const agent = new Agent({
    model: createModel(),
    streamFn: async function* () {
      yield { type: "text_delta" as const, value: "Hello" };
      yield { type: "done" as const };
    },
  });

  await agent.prompt("Hello");
  const last = agent.getMessages().at(-1)?.role;
  console.log(`  last role: ${last}`);

  let threw = false;
  try {
    await agent.continue();
  } catch (err: any) {
    threw = true;
    console.log(`  ✅ threw: ${err.message.slice(0, 80)}`);
  }
  console.assert(threw, "❌ continue() 应在 assistant 之后抛错");
  console.log("✅ continue() 校验通过\n");
}

// ─── 6) streamFn — 代理后端 / mock ──────────────────────────────────────────

async function testStreamFnMock() {
  console.log("【7】streamFn — mock 代理后端（无需 API key）\n");

  let captured: AgentMessage[] = [];

  const agent = new Agent({
    model: createModel(), // 仍需要传 model，但 streamFn 会接管
    streamFn: async function* (messages) {
      captured = messages;
      console.log(`  → proxy received ${messages.length} message(s)`);
      yield { type: "text_delta" as const, value: "Hello from proxy! " };
      yield { type: "text_delta" as const, value: "No real API used." };
      yield { type: "done" as const };
    },
  });

  let response = "";
  agent.subscribe((e) => {
    if (e.type === "message_update") response += e.delta;
  });

  await agent.prompt("ping");
  console.log(`  response: "${response}"`);

  console.assert(captured.length > 0, "❌ streamFn 应收到 messages");
  console.assert(response.includes("proxy"), "❌ streamFn 输出未传递");
  console.log("✅ streamFn 通过\n");
}

// ─── 7) thinkingLevel + thinking_update ────────────────────────────────────

async function testThinking() {
  console.log("【8】thinkingLevel + thinking_update 事件\n");

  let receivedLevel: string | undefined;
  const thinkingDeltas: string[] = [];

  const agent = new Agent({
    model: createModel(),
    thinkingLevel: "high",
    streamFn: async function* (_messages, opts) {
      receivedLevel = opts.thinkingLevel;
      console.log(`  → thinkingLevel = ${opts.thinkingLevel}`);
      yield { type: "thinking_delta" as const, value: "Let me think..." };
      yield { type: "thinking_delta" as const, value: " Processing..." };
      yield { type: "text_delta" as const, value: "Answer: 42" };
      yield { type: "done" as const };
    },
  });

  agent.subscribe((e) => {
    if (e.type === "thinking_update") thinkingDeltas.push(e.delta);
  });

  await agent.prompt("What is the answer?");

  console.assert(receivedLevel === "high", "❌ thinkingLevel 未透传");
  console.assert(thinkingDeltas.length === 2, `❌ 期望 2 个 thinking_delta，实际 ${thinkingDeltas.length}`);
  console.log(`  thinking deltas: ${thinkingDeltas.length}`);
  console.log("✅ thinkingLevel + thinking_update 通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function control() {
  console.log("\n========== 04 Control: 运行流程控制 ==========\n");

  try {
    // 1-2 需要真实 API（涉及 model.stream 流程）
    if (checkEnv()) {
      await testAbortDuringTool();
      await testExternalAbortController();
    } else {
      console.log("【1-2】AbortSignal — 跳过（LLM_API_KEY 未设置）\n");
    }

    // 3-8 用 mock streamFn，不依赖真实 API
    await testSteeringOneAtATime();
    await testSteeringAll();
    await testWaitForIdle();
    await testContinueValidation();
    await testStreamFnMock();
    await testThinking();

    console.log("========== 04 Control 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
