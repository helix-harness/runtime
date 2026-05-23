/**
 * Case 1: Model Layer 基础配置
 *
 * 演示：
 * - getModel 精确查找
 * - getModel capability-based 查找
 * - 不同 OpenAI-compatible provider 的 baseURL 配置
 */

import { getModel } from "@helix/models";

export async function modelBasic() {
  console.log("\n========== Case 1: Model Basic ==========\n");

  // 检查环境变量
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  // 1. 精确指定 + config
  console.log("【1】精确指定 provider + model + config\n");

  const configExamples = [
    { model: "gpt-4o", provider: "openai-compatible", baseURL: null },
    { model: "deepseek-chat", provider: "openai-compatible", baseURL: "https://api.deepseek.com/v1" },
    { model: "llama-3.1-70b", provider: "openai-compatible", baseURL: "https://api.groq.com/openai/v1" },
  ];

  for (const cfg of configExamples) {
    const baseURL = cfg.baseURL ?? "(默认 api.openai.com/v1)";
    console.log(`  ${cfg.model}:`);
    console.log(`    baseURL: ${baseURL}`);
  }

  // 2. Capability-based 查找
  console.log("\n【2】Capability-based 查找\n");

  const tags = [
    { tag: "reasoning", desc: "强推理能力", models: ["gpt-4o", "o3"] },
    { tag: "fast-reasoning", desc: "快速推理", models: ["gpt-4o-mini", "o4-mini"] },
    { tag: "cheap-chat", desc: "低成本对话", models: ["gpt-4o-mini"] },
    { tag: "code-specialist", desc: "代码专家", models: ["o3", "o4-mini"] },
  ];

  for (const t of tags) {
    console.log(`  ${t.tag}: ${t.desc}`);
    console.log(`    匹配模型: ${t.models.join(", ")}`);
  }

  // 3. 实际调用（需要 API Key）
  console.log("\n【3】实际调用测试\n");

  if (hasOpenAI) {
    const model = getModel("openai-compatible", "gpt-4o", {
      apiKey: process.env.OPENAI_API_KEY!,
    });

    console.log("✅ OpenAI adapter 创建成功");
    console.log("   adapter:", model?.constructor.name);

    // 简单 stream 测试
    if (model) {
      const messages = [{ role: "user" as const, content: "Hello, 1+1=?", timestamp: Date.now() }];

      console.log("\n   开始 stream...");
      for await (const chunk of model.stream(messages, {})) {
        if (chunk.type === "text_delta") {
          process.stdout.write(chunk.value);
        }
        if (chunk.type === "done") {
          console.log("\n   ✅ stream 完成");
        }
      }
    }
  } else {
    console.log("❌ OPENAI_API_KEY 未设置，跳过实际调用");
    console.log("   export OPENAI_API_KEY=sk-...");
  }

  console.log("\n========== Case 1 结束 ==========\n");
}
