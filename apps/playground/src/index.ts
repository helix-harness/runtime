/**
 * Helix Runtime Playground
 *
 * 运行示例：
 *   pnpm dev                    # 运行所有示例
 *   pnpm dev -- model-basic     # 运行指定示例
 */

import { modelBasic } from "./cases/model-basic";
import { agentWithTools } from "./cases/agent-with-tools";
import { eventSequence } from "./cases/event-sequence";
import { multiTurn } from "./cases/multi-turn";
import { convert } from "./cases/convert";
import { compactionCase } from "./cases/compaction";
import { abortSignal } from "./cases/abort-signal";
import { anthropicToolCall } from "./cases/anthropic-tool-call";
import { toolCallBasic } from "./cases/tool-call-basic";
import { toolExecutionMode } from "./cases/tool-execution-mode";
import { toolHooks } from "./cases/tool-hooks";
import { asyncGeneratorCase } from "./cases/async-generator";
import { sessionCase } from "./cases/session";

type Case = {
  name: string;
  description: string;
  run: () => Promise<void>;
};

const cases: Case[] = [
  // ── Model Layer ──────────────────────────────────────────────────────────────
  { name: "model-basic", description: "Model Layer: 基础配置", run: modelBasic },

  // ── Agent Core ─────────────────────────────────────────────────────────────
  { name: "agent-with-tools", description: "Agent Class: 有状态封装 + Tool Calling", run: agentWithTools },

  // ── v0.2 Message Transform Layer ───────────────────────────────────────────
  { name: "event-sequence", description: "事件: 断言事件顺序正确", run: eventSequence },
  { name: "multi-turn", description: "消息: 多轮对话累积", run: multiTurn },
  { name: "convert", description: "钩子: convertToLlm 验证", run: convert },
  { name: "compaction", description: "钩子: transformContext 压缩验证", run: compactionCase },

  // ── Tool Calling ────────────────────────────────────────────────────────────
  { name: "tool-call-basic", description: "Tool: 基础 tool 调用", run: toolCallBasic },
  { name: "tool-execution-mode", description: "Tool: parallel/sequential 执行模式", run: toolExecutionMode },
  { name: "tool-hooks", description: "Tool: beforeToolCall/afterToolCall 钩子", run: toolHooks },
  { name: "abort-signal", description: "Tool: AbortSignal 中断验证", run: abortSignal },
  { name: "anthropic-tool-call", description: "Tool: Anthropic Adapter tool 调用", run: anthropicToolCall },

  // ── v0.4 AsyncGenerator ─────────────────────────────────────────────────────
  { name: "async-generator", description: "Loop: agentLoop AsyncGenerator 验证", run: asyncGeneratorCase },

  // ── v0.6 Session Persistence ────────────────────────────────────────────────
  { name: "session", description: "Session: 持久化存储验证", run: sessionCase },
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
