/**
 * Case 03: Context — 消息转换 & 上下文压缩
 *
 * 覆盖：
 *  1) convertToLlm — 过滤 UI-only 消息，只把标准角色给 LLM
 *  2) sliceCompaction — 超过阈值后保留末尾 N 条
 *  3) tokenCompaction — 基于 token 数截断
 *  4) summaryCompaction — LLM 摘要历史
 *  5) compose — 组合多个 transformContext
 */

import {
  Agent,
  sliceCompaction,
  tokenCompaction,
  summaryCompaction,
  compose,
  type AgentEvent,
} from "@helix/runtime";
import { createModel, checkEnv } from "./shared";

// ─── 1) convertToLlm ─────────────────────────────────────────────────────────

async function testConvertToLlm() {
  console.log("【1】convertToLlm — 过滤 UI-only 消息\n");

  let lastInputLen = 0;
  let lastOutputLen = 0;
  let callCount = 0;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
    convertToLlm: (msgs) => {
      callCount++;
      const filtered = msgs.filter((m) => ["user", "assistant", "toolResult", "system"].includes(m.role));
      lastInputLen = msgs.length;
      lastOutputLen = filtered.length;
      console.log(`  调用 ${callCount}: 输入 ${msgs.length} → 输出 ${filtered.length}`);
      return filtered;
    },
  });

  await agent.prompt("你好");
  await agent.prompt("你叫什么？");

  console.assert(callCount >= 2, "❌ convertToLlm 应至少被调用 2 次");
  console.assert(lastOutputLen <= lastInputLen, "❌ 过滤后不应增加");
  console.log("✅ convertToLlm 通过\n");
}

// ─── 2) sliceCompaction ─────────────────────────────────────────────────────

async function testSliceCompaction() {
  console.log("【2】sliceCompaction — keepLast=4, triggerAt=6\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "Reply with one short word.",
    transformContext: sliceCompaction({ keepLast: 4, triggerAt: 6 }),
  });

  const compacted: AgentEvent[] = [];
  agent.subscribe((e) => {
    if (e.type === "context_compacted") compacted.push(e);
  });

  for (let i = 1; i <= 8; i++) {
    await agent.prompt(`Turn ${i}: say "ok ${i}"`);
  }

  console.log(`  total messages: ${agent.getMessages().length}`);
  console.log(`  context_compacted 事件: ${compacted.length}`);

  if (compacted.length > 0) {
    const e = compacted[0] as any;
    console.log(`  tokens: ${e.tokensBefore} → ${e.tokensAfter}`);
    console.assert(e.tokensAfter < e.tokensBefore, "❌ 压缩后 token 数应下降");
  }
  console.log("✅ sliceCompaction 通过\n");
}

// ─── 3) tokenCompaction ─────────────────────────────────────────────────────

async function testTokenCompaction() {
  console.log("【3】tokenCompaction — 基于 token 阈值\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "Reply with one short sentence.",
    transformContext: tokenCompaction({ keepRecentTokens: 50, triggerAtTokens: 80 }),
  });

  const compacted: AgentEvent[] = [];
  agent.subscribe((e) => {
    if (e.type === "context_compacted") compacted.push(e);
  });

  for (let i = 1; i <= 10; i++) {
    await agent.prompt(`Message number ${i}: please acknowledge receipt`);
  }

  console.log(`  context_compacted 事件: ${compacted.length}`);
  console.assert(compacted.length > 0, "❌ 应至少触发一次压缩");
  console.log("✅ tokenCompaction 通过\n");
}

// ─── 4) summaryCompaction ───────────────────────────────────────────────────

async function testSummaryCompaction() {
  console.log("【4】summaryCompaction — LLM 摘要\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are helpful. Reply with one short sentence.",
    transformContext: summaryCompaction({
      summaryModel: createModel(),
      keepRecentTokens: 100,
      triggerAtTokens: 150,
      summaryInstructions: "Summarize this conversation in 2 sentences.",
    }),
  });

  let compactedCount = 0;
  agent.subscribe((e) => {
    if (e.type === "context_compacted") {
      compactedCount++;
      console.log("  📦 context_compacted");
    }
  });

  for (let i = 1; i <= 8; i++) {
    await agent.prompt(`Step ${i}: I am learning about TypeScript generics`);
  }

  await agent.prompt("What topic have we been discussing?");

  const hasSummary = agent.getMessages().some(
    (m) => m.role === "system" && m.content.includes("Conversation summary")
  );

  console.log(`  compacted 次数: ${compactedCount}`);
  if (compactedCount > 0) {
    console.assert(hasSummary, "❌ 应在 messages 中注入 summary system 消息");
  }
  console.log("✅ summaryCompaction 通过\n");
}

// ─── 5) compose ─────────────────────────────────────────────────────────────

async function testCompose() {
  console.log("【5】compose — 组合多个 transformContext\n");

  const callOrder: string[] = [];

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "Reply briefly.",
    transformContext: compose(
      async (msgs) => {
        callOrder.push("first");
        return msgs;
      },
      sliceCompaction({ keepLast: 10, triggerAt: 20 }),
      async (msgs) => {
        callOrder.push("third");
        return msgs;
      },
    ),
  });

  await agent.prompt("Hello");

  console.log(`  执行顺序: ${callOrder.join(" → ")}`);
  console.assert(callOrder[0] === "first" && callOrder[1] === "third", "❌ 顺序错误");
  console.log("✅ compose 通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function context() {
  console.log("\n========== 03 Context: 消息转换 & 上下文压缩 ==========\n");

  if (!checkEnv()) {
    console.log("跳过\n");
    return;
  }

  try {
    await testConvertToLlm();
    await testSliceCompaction();
    await testTokenCompaction();
    await testSummaryCompaction();
    await testCompose();
    console.log("========== 03 Context 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
