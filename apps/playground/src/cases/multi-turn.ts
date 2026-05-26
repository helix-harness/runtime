/**
 * Case: Multi-Turn Message Accumulation
 *
 * 验证：
 * - 连续 prompt 两次
 * - messages 正确累积
 */

import { Agent } from "@helix/runtime";
import { createModel, checkEnv } from "./shared";

export async function multiTurn() {
  console.log("\n========== Case: Multi-Turn ==========\n");

  if (!checkEnv()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
  });

  const msgCounts: number[] = [];

  // 第 1 轮
  await agent.prompt("我叫小明");
  msgCounts.push(agent.getMessages().length);
  console.log(`第 1 轮后: ${msgCounts[0]} 条消息`);

  // 第 2 轮
  await agent.prompt("我叫什么名字？");
  msgCounts.push(agent.getMessages().length);
  console.log(`第 2 轮后: ${msgCounts[1]} 条消息`);

  // 验证累积
  const checks = [
    { pass: msgCounts[1]! > msgCounts[0]!, msg: `第2轮消息数(${msgCounts[1]}) > 第1轮(${msgCounts[0]})` },
    { pass: msgCounts[0]! >= 2, msg: `第1轮至少有 2 条消息 (user + assistant)` },
  ];

  console.log("\n断言结果:");
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.msg}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? "✅ 全部通过" : "❌ 存在失败"}`);

  // 打印消息详情
  console.log("\n消息列表:");
  for (const msg of agent.getMessages()) {
    console.log(`  [${msg.role}]: ${msg.content.slice(0, 50)}${msg.content.length > 50 ? "..." : ""}`);
  }

  console.log("\n========== Case 结束 ==========\n");
}