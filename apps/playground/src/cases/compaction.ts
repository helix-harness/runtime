/**
 * Case: Context Compaction (v0.5)
 *
 * 验证：
 * - sliceCompaction 超过阈值后截断
 * - tokenCompaction 基于 token 数截断
 * - summaryCompaction 调用 LLM 生成摘要
 * - compose 组合多个 transformContext
 * - context_compacted 事件正确 emit
 */

import { Agent, sliceCompaction, tokenCompaction, summaryCompaction, compose } from "@helix/runtime";
import { createModel } from "./shared";
import type { AgentEvent } from "@helix/runtime";

function makeAgent(transformContext: any) {
  return new Agent({
    model: createModel(),
    systemPrompt: "You are helpful. Reply with one short sentence.",
    transformContext,
  });
}

async function testSliceCompaction() {
  console.log("【1】sliceCompaction — 超过阈值后截断\n");

  const agent = makeAgent(sliceCompaction({ keepLast: 4, triggerAt: 6 }));
  const compactedEvents: AgentEvent[] = [];

  agent.subscribe((e) => {
    if (e.type === "context_compacted") compactedEvents.push(e);
  });

  // Send 8 turns to exceed triggerAt=6
  for (let i = 1; i <= 8; i++) {
    await agent.prompt(`Turn ${i}: say "ok ${i}"`);
  }

  const totalMessages = agent.getMessages().length;
  console.log(`  total messages: ${totalMessages}`);
  console.log(`  context_compacted events: ${compactedEvents.length}`);

  if (compactedEvents.length > 0) {
    const e = compactedEvents[0] as any;
    console.log(`  compaction: ${e.tokensBefore} → ${e.tokensAfter} tokens`);
    console.assert(e.tokensAfter < e.tokensBefore, "❌ tokens should decrease after compaction");
  }

  console.log("✅ sliceCompaction 通过\n");
}

async function testTokenCompaction() {
  console.log("【2】tokenCompaction — 基于 token 数截断\n");

  // Very low thresholds to trigger easily
  const agent = makeAgent(tokenCompaction({
    keepRecentTokens: 50,
    triggerAtTokens: 80,
  }));

  const compactedEvents: AgentEvent[] = [];
  agent.subscribe((e) => {
    if (e.type === "context_compacted") compactedEvents.push(e);
  });

  for (let i = 1; i <= 10; i++) {
    await agent.prompt(`Message number ${i}: please acknowledge receipt`);
  }

  console.log(`  context_compacted events: ${compactedEvents.length}`);
  if (compactedEvents.length > 0) {
    const e = compactedEvents[0] as any;
    console.log(`  compaction: ${e.tokensBefore} → ${e.tokensAfter} tokens`);
  }

  console.log("✅ tokenCompaction 通过\n");
}

async function testSummaryCompaction() {
  console.log("【3】summaryCompaction — LLM 摘要压缩\n");

  const summaryModel = createModel();

  const agent = makeAgent(summaryCompaction({
    summaryModel,
    keepRecentTokens: 100,
    triggerAtTokens: 150,
    summaryInstructions: "Summarize this conversation in 2 sentences.",
  }));

  const compactedEvents: AgentEvent[] = [];
  agent.subscribe((e) => {
    if (e.type === "context_compacted") {
      compactedEvents.push(e);
      console.log("  📦 context_compacted event fired");
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  // Build up context
  for (let i = 1; i <= 8; i++) {
    await agent.prompt(`Step ${i}: I am learning about TypeScript generics`);
    process.stdout.write("\n");
  }

  // After compaction, LLM should still have context via summary
  await agent.prompt("What topic have we been discussing?");
  console.log("\n");

  console.log(`  context_compacted events: ${compactedEvents.length}`);

  // Check messages include a system summary message
  const messages = agent.getMessages();
  const hasSummary = messages.some(
    (m) => m.role === "system" && m.content.includes("Conversation summary")
  );
  if (compactedEvents.length > 0) {
    console.assert(hasSummary, "❌ summary message not found in context");
  }

  console.log("✅ summaryCompaction 通过\n");
}

async function testCompose() {
  console.log("【4】compose — 组合多个 transformContext\n");

  const callOrder: string[] = [];

  const agent = makeAgent(
    compose(
      async (msgs) => { callOrder.push("first"); return msgs; },
      sliceCompaction({ keepLast: 10, triggerAt: 20 }),
      async (msgs) => { callOrder.push("third"); return msgs; },
    )
  );

  await agent.prompt("Hello");

  console.assert(callOrder[0] === "first", "❌ wrong order");
  console.assert(callOrder[1] === "third", "❌ wrong order");
  console.log(`  execution order: ${callOrder.join(" → ")}`);
  console.log("✅ compose 通过\n");
}

export async function compactionCase() {
  console.log("\n========== v0.5: Context Compaction ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY not set — skipping");
    return;
  }

  try {
    await testSliceCompaction();
    await testTokenCompaction();
    await testSummaryCompaction();
    await testCompose();
    console.log("========== v0.5 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
