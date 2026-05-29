/**
 * Helix Runtime Playground
 *
 * 运行示例：
 *   pnpm dev                  # 运行所有示例
 *   pnpm dev -- basics        # 运行指定示例
 *
 * 6 个 case 按功能领域分类：
 *   - basics    : Model + Agent 入门（流式、多轮、事件、agentLoop 低层）
 *   - tools     : Tool 系统（调用、执行模式、错误、钩子）
 *   - context   : 消息转换 & 上下文压缩
 *   - control   : 流程控制（abort、steering、waitForIdle、continue、streamFn、thinking）
 *   - subagent  : Sub-agent 多 agent 协作
 *   - session   : Session 持久化
 */

import { basics } from "./cases/01-basics";
import { tools } from "./cases/02-tools";
import { context } from "./cases/03-context";
import { control } from "./cases/04-control";
import { subagent } from "./cases/05-subagent";
import { session } from "./cases/06-session";

type Case = {
  name: string;
  description: string;
  run: () => Promise<void>;
};

const cases: Case[] = [
  { name: "basics", description: "Model + Agent 入门（Model 流式、多轮、事件、agentLoop 低层）", run: basics },
  { name: "tools", description: "Tool 系统（调用、parallel/sequential、错误、before/after/shouldStop 钩子）", run: tools },
  { name: "context", description: "消息转换 & 上下文压缩（convertToLlm + transformContext）", run: context },
  { name: "control", description: "流程控制（abort、steeringMode、waitForIdle、continue、streamFn、thinking）", run: control },
  { name: "subagent", description: "Sub-agent 多 agent 协作（createSubagentTool）", run: subagent },
  { name: "session", description: "Session 持久化（Memory + File）", run: session },
];

async function main() {
  const args = process.argv.slice(2);
  const caseName = args.find((a) => !a.startsWith("-"));

  if (caseName) {
    const selected = cases.find((c) => c.name === caseName);
    if (selected) {
      await selected.run();
    } else {
      console.error(`❌ 未找到示例: ${caseName}\n`);
      console.log("可用示例:");
      for (const c of cases) console.log(`  ${c.name.padEnd(10)} ${c.description}`);
    }
    return;
  }

  console.log("========================================");
  console.log("  Helix Runtime Playground");
  console.log("========================================\n");
  console.log("用法:");
  console.log("  pnpm dev               # 运行所有示例");
  console.log("  pnpm dev -- <case>     # 运行指定示例\n");
  console.log("可用示例:");
  for (const c of cases) console.log(`  ${c.name.padEnd(10)} ${c.description}`);
  console.log("");

  for (const c of cases) {
    try {
      await c.run();
    } catch (err) {
      console.error(`❌ ${c.name} 执行失败:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
