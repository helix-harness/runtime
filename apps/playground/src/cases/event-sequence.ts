/**
 * Case: Event Sequence Assertion
 *
 * 验证事件顺序：agent_start → turn_start → message_start → ... → agent_end
 */

import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";

export async function eventSequence() {
  console.log("\n========== Case: Event Sequence ==========\n");

  if (!process.env.LLM_API_KEY) {
    console.log("❌ LLM_API_KEY 未设置");
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  const modelId = process.env.LLM_MODEL_ID ?? "gpt-4o";

  const agent = new Agent({
    model: getModel({
      model: modelId,
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    }),
    systemPrompt: "你是一个简洁的助手。",
  });

  const events: string[] = [];
  const checks: { pass: boolean; msg: string }[] = [];

  agent.subscribe((e) => {
    events.push(e.type);
  });

  await agent.prompt("1+1等于几？只回答数字。");

  // 验证事件顺序
  const agentStartIdx = events.indexOf("agent_start");
  const turnStartIdx = events.indexOf("turn_start");
  const agentEndIdx = events.indexOf("agent_end");
  const messageStartIdx = events.indexOf("message_start");
  const messageEndIdx = events.indexOf("message_end");

  checks.push({
    pass: agentStartIdx !== -1,
    msg: `agent_start 存在: ${agentStartIdx !== -1}`,
  });
  checks.push({
    pass: turnStartIdx !== -1,
    msg: `turn_start 存在: ${turnStartIdx !== -1}`,
  });
  checks.push({
    pass: agentEndIdx !== -1,
    msg: `agent_end 存在: ${agentEndIdx !== -1}`,
  });
  checks.push({
    pass: agentStartIdx < turnStartIdx,
    msg: `agent_start (${agentStartIdx}) < turn_start (${turnStartIdx})`,
  });
  checks.push({
    pass: turnStartIdx < agentEndIdx,
    msg: `turn_start (${turnStartIdx}) < agent_end (${agentEndIdx})`,
  });
  checks.push({
    pass: messageStartIdx < messageEndIdx,
    msg: `message_start (${messageStartIdx}) < message_end (${messageEndIdx})`,
  });
  checks.push({
    pass: messageEndIdx < turnStartIdx + events.slice(turnStartIdx).indexOf("turn_end") + 1,
    msg: `message_end 发生在 turn 内`,
  });

  console.log("事件序列:", events.join(" → "));
  console.log("\n断言结果:");
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.msg}`);
  }

  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? "✅ 全部通过" : "❌ 存在失败"}`);
  console.log("\n========== Case 结束 ==========\n");
}