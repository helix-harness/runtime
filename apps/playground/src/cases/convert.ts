/**
 * Case: convertToLlm Hook Verification
 *
 * 验证：
 * - convertToLlm 被调用
 * - 过滤后的消息数正确
 */

import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";

export async function convert() {
  console.log("\n========== Case: convertToLlm ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  const modelId = process.env.LLM_MODEL_ID ?? "gpt-4o";

  let convertCallCount = 0;
  let lastFilteredCount = 0;

  const agent = new Agent({
    model: getModel({
      model: modelId,
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    }),
    systemPrompt: "你是一个简洁的助手。",
    convertToLlm: (msgs) => {
      convertCallCount++;
      // 只保留 user 和 assistant，过滤掉其他角色
      const filtered = msgs.filter((m) => ["user", "assistant"].includes(m.role));
      lastFilteredCount = filtered.length;
      console.log(`[convertToLlm] 调用 ${convertCallCount}: 输入 ${msgs.length} 条, 输出 ${filtered.length} 条`);
      return filtered;
    },
  });

  // 第 1 轮
  console.log("\n--- 第 1 轮 ---");
  await agent.prompt("你好");

  const countAfterRound1 = convertCallCount;
  const filteredAfterRound1 = lastFilteredCount;

  // 第 2 轮
  console.log("\n--- 第 2 轮 ---");
  await agent.prompt("你叫什么？");

  // 断言
  const checks = [
    { pass: convertCallCount >= 2, msg: `convertToLlm 被调用至少 2 次 (实际: ${convertCallCount})` },
    { pass: filteredAfterRound1 >= 1, msg: `第 1 轮过滤后至少 1 条 (user message, 实际: ${filteredAfterRound1})` },
    { pass: lastFilteredCount > filteredAfterRound1, msg: `第 2 轮消息数(${lastFilteredCount}) > 第 1 轮(${filteredAfterRound1})` },
  ];

  console.log("\n断言结果:");
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.msg}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? "✅ 全部通过" : "❌ 存在失败"}`);
  console.log("\n========== Case 结束 ==========\n");
}