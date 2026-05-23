/**
 * Case 3: Model Chunk Types
 *
 * 演示：
 * - text_delta: 流式文本
 * - tool_call_delta: 增量 tool call 参数
 * - tool_call: 完整的 parsed tool call
 * - done: 流式结束
 */

import { getModel } from "@helix/models";

export async function chunkTypes() {
  console.log("\n========== Case 3: Model Chunk Types ==========\n");

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  console.log("【ModelChunk 类型】\n");
  console.log("  text_delta:    流式文本片段");
  console.log("  tool_call_delta: 增量 tool call 参数（streaming 时 args 可能被分割）");
  console.log("  tool_call:     完整的 parsed tool call（finish_reason=tool_calls 时）");
  console.log("  done:          流式结束");

  if (!hasOpenAI) {
    console.log("\n❌ OPENAI_API_KEY 未设置，跳过实际调用");
    console.log("   export OPENAI_API_KEY=sk-...");
    console.log("\n========== Case 3 结束 ==========\n");
    return;
  }

  console.log("\n【实际 Chunk 观察】\n");

  const model = getModel("openai-compatible", "gpt-4o", {
    apiKey: process.env.OPENAI_API_KEY!,
  });

  if (!model) {
    console.log("❌ Model adapter 创建失败");
    return;
  }

  const messages = [
    { role: "user" as const, content: "请帮我起一个英文名字，中文意思是勇敢。", timestamp: Date.now() },
  ];

  let chunkCount = 0;
  const textChunks: string[] = [];

  for await (const chunk of model.stream(messages, {})) {
    chunkCount++;

    if (chunk.type === "text_delta") {
      process.stdout.write(chunk.value);
      textChunks.push(chunk.value);
    }

    if (chunk.type === "done") {
      console.log("\n");
    }
  }

  console.log("\n【统计】");
  console.log(`  总 Chunk 数: ${chunkCount}`);
  console.log(`  text_delta 次数: ${textChunks.length}`);
  console.log(`  合并后文本长度: ${textChunks.join("").length} 字符`);

  console.log("\n========== Case 3 结束 ==========\n");
}
