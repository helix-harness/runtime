/**
 * Case: transformContext Hook (Compaction) Verification
 *
 * 验证：
 * - transformContext 被调用
 * - 超过阈值时 compaction 被触发
 * - context_compacted 事件正确发出
 */

import { Agent } from "@helix/runtime";
import { createModel, checkEnv } from "./shared";

const MAX_MESSAGES = 4;

export async function compaction() {
  console.log("\n========== Case: transformContext (Compaction) ==========\n");

  if (!checkEnv()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  let transformCallCount = 0;
  let compactCount = 0;
  let hasCompactedEvent = false;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
    // 超过 4 条消息时，压缩到最近 4 条
    transformContext: async (msgs, signal) => {
      transformCallCount++;
      console.log(`[transformContext] 调用 ${transformCallCount}: 输入 ${msgs.length} 条消息`);

      if (msgs.length > MAX_MESSAGES) {
        const compacted = msgs.slice(-MAX_MESSAGES);
        console.log(`[transformContext] 压缩: ${msgs.length} → ${compacted.length}`);
        compactCount++;
        return compacted;
      }
      return msgs;
    },
  });

  agent.subscribe((e) => {
    if (e.type === "context_compacted") {
      hasCompactedEvent = true;
      console.log(`[event] context_compacted: ${e.tokensBefore} → ${e.tokensAfter}`);
    }
  });

  // 发 6 轮，触发 compaction
  console.log("\n--- 开始 6 轮对话 ---\n");
  for (let i = 0; i < 6; i++) {
    console.log(`第 ${i + 1} 轮:`);
    await agent.prompt(`第${i + 1}轮`);
    console.log(`  当前消息数: ${agent.getMessages().length}`);
  }

  // 断言
  const checks = [
    { pass: transformCallCount >= 6, msg: `transformContext 被调用至少 6 次 (实际: ${transformCallCount})` },
    { pass: compactCount > 0, msg: `compaction 被触发 (实际: ${compactCount} 次)` },
    { pass: hasCompactedEvent, msg: `context_compacted 事件已发出` },
  ];

  console.log("\n断言结果:");
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.msg}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? "✅ 全部通过" : "❌ 存在失败"}`);
  console.log("\n========== Case 结束 ==========\n");
}