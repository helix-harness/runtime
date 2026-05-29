/**
 * Case 07: Multimodal — 图片多模态支持
 *
 * 覆盖：
 *  1) Model 流式 + base64 图片（低层 API）
 *  2) Agent.prompt + base64 图片（高层 API）
 *
 * 注意：需要 provider 支持 vision（如 OpenAI gpt-4o、Anthropic claude-sonnet-4）。
 * 不支持 vision 的 provider 会跳过测试。
 */

import { Agent } from "@helix/runtime";
import type { AgentMessage } from "@helix/core";
import { textPart, imagePart } from "@helix/core";
import { createModel, checkEnv } from "./shared";

// 2x2 红色 PNG（纯 base64，不含 data: 前缀）
const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";

// ─── 1) Model 流式 + base64 图片 ─────────────────────────────────────────────

async function testModelStreamImage() {
  console.log("【1】Model 流式 + base64 图片（低层 API）\n");

  const model = createModel();
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [
        textPart("这张图是什么颜色？只回答颜色。"),
        imagePart(RED_PIXEL_PNG, "image/png"),
      ],
      timestamp: Date.now(),
    },
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
  console.log("✅ Model 流式 + 图片通过\n");
}

// ─── 2) Agent.prompt + base64 图片 ───────────────────────────────────────────

async function testAgentPromptImage() {
  console.log("【2】Agent.prompt + base64 图片（高层 API）\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  process.stdout.write("  → ");
  await agent.prompt([
    textPart("描述这张图片的内容"),
    imagePart(RED_PIXEL_PNG, "image/png"),
  ]);
  console.log("\n");

  const messages = agent.getMessages();
  console.assert(messages.length >= 2, "❌ Agent 应至少累积 user + assistant 两条消息");
  console.log(`  messages: ${messages.length}`);
  console.log("✅ Agent.prompt + 图片通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function multimodal() {
  console.log("\n========== 07 Multimodal: 图片多模态支持 ==========\n");

  if (!checkEnv()) {
    console.log("跳过\n");
    return;
  }

  try {
    await testModelStreamImage();
    await testAgentPromptImage();
    console.log("========== 07 Multimodal 全部通过 ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
