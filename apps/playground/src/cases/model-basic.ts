/**
 * Case 1: Model Layer 基础调用测试
 */

import { getModel } from "@helix/models";
import type { AgentMessage } from "@helix/core";


async function runStream(label: string, model: ReturnType<typeof getModel>) {
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

    if (!process.env.LLM_API_KEY) {
        console.log("❌ LLM_API_KEY 未设置");
        console.log("\n========== Case 1 结束 ==========\n");
        return;
    }

    const modelId = process.env.LLM_MODEL_ID ?? "gpt-4o";

    await runStream(
        modelId,
        getModel({
            model: modelId,
            apiKey: process.env.LLM_API_KEY,
            baseURL: process.env.LLM_BASE_URL,
        })
    );
    console.log("\n========== Case 1 结束 ==========\n");
}