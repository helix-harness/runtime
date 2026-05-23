/**
 * Helix Runtime Playground
 *
 * 运行示例：
 *   pnpm dev                    # 运行所有示例
 *   pnpm dev -- model-basic     # 运行指定示例
 */

import { modelBasic } from "./cases/model-basic";
import { toolCall } from "./cases/tool-call";
import { chunkTypes } from "./cases/chunk-types";

type Case = {
  name: string;
  description: string;
  run: () => Promise<void>;
};

const cases: Case[] = [
  { name: "model-basic", description: "Model Layer 基础配置", run: modelBasic },
  { name: "tool-call", description: "Tool Calling 演示", run: toolCall },
  { name: "chunk-types", description: "ModelChunk 类型观察", run: chunkTypes },
];

async function main() {
  const args = process.argv.slice(2);
  const caseName = args.find((a) => !a.startsWith("-"));

  if (caseName) {
    const selectedCase = cases.find((c) => c.name === caseName);

    if (selectedCase) {
      await selectedCase.run();
    } else {
      console.error(`❌ 未找到示例: ${caseName}`);
      console.log("\n可用示例:");
      for (const c of cases) {
        console.log(`  --${c.name}: ${c.description}`);
      }
    }
    return;
  }

  console.log("========================================");
  console.log("  Helix Runtime Playground");
  console.log("========================================\n");
  console.log("用法:");
  console.log("  pnpm dev              # 运行所有示例");
  console.log("  pnpm dev -- <case>    # 运行指定示例\n");
  console.log("可用示例:");
  for (const c of cases) {
    console.log(`  --${c.name}: ${c.description}`);
  }
  console.log("");

  // 运行所有示例
  for (const c of cases) {
    try {
      await c.run();
    } catch (err) {
      console.error(`❌ 示例 ${c.name} 执行失败:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
