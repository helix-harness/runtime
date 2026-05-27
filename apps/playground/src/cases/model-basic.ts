/**
 * Case 1: Model Layer 基础调用测试
 */

import { createModel } from "./shared";
import type { AgentMessage, ModelAdapter } from "@helix/core";


async function runStream(label: string, model: ModelAdapter) {
  const messages: AgentMessage[] = [
    { role: "user", content: "1+1=? 只回答数字", timestamp: Date.now() },
  ];

  process.stdout.write(`  ${label}: `);

  for await (const chunk of model.stream(messages, {})) {
    if (chunk.type === "text_delta") {
      process.stdout.write(chunk.value);
    }
    if (chunk.type === "done") {
      process.stdout.write(" ✅\n");
    }
  }
}

export async function modelBasic() {
    console.log("\n========== Case 1: Model Basic ==========\n");

    const model = createModel();

    await runStream(
        process.env.LLM_MODEL_ID ?? "gpt-4o",
        model
    );
    console.log("\n========== Case 1 结束 ==========\n");
}