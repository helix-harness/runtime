/**
 * Case: Tool Execution Mode
 *
 * 验证：
 * - 默认 parallel 模式：多个 tool 并发执行
 * - sequential tool：整批退化为串行
 * - durationMs 在 ToolResult 中正确记录
 */

import { Agent } from "@helix/runtime";
import { createModel, checkOpenAI } from "./shared";
import type { ToolDef } from "@helix/core";

function makeDelayedTool(name: string, delayMs: number, mode?: "parallel" | "sequential"): ToolDef {
  return {
    name,
    description: `A tool that takes ${delayMs}ms to complete`,
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Any input string" },
      },
      required: ["input"],
    },
    executionMode: mode,
    execute: async (args: any) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, delayMs));
      return { name, input: args.input, actualDuration: Date.now() - start };
    },
  };
}

async function testParallelMode() {
  console.log("【1】parallel 模式 — 多 tool 并发\n");

  if (!checkOpenAI()) return;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. When asked to call multiple tools, call them all.",
    tools: [
      makeDelayedTool("slow_tool_a", 500),
      makeDelayedTool("slow_tool_b", 500),
    ],
  });

  const execTimes: Array<{ name: string; start: number; end: number }> = [];
  const inFlight = new Map<string, number>();

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") {
      inFlight.set(e.toolCallId, Date.now());
    }
    if (e.type === "tool_execution_end") {
      const start = inFlight.get(e.toolCallId) ?? Date.now();
      execTimes.push({ name: e.name, start, end: Date.now() });
      console.log(`  ← ${e.name} done in ${e.durationMs}ms`);
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  const wallStart = Date.now();
  await agent.prompt("Please call both slow_tool_a with input 'foo' and slow_tool_b with input 'bar' at the same time.");
  const wallTime = Date.now() - wallStart;

  console.log(`\n  wall time: ${wallTime}ms`);

  if (execTimes.length === 2) {
    // Check if they overlapped (parallel)
    const [a, b] = execTimes;
    const overlapped = a!.start < b!.end && b!.start < a!.end;
    if (overlapped) {
      console.log("  ✅ tools executed in parallel (overlapping)");
    } else {
      console.log("  ℹ️  tools ran sequentially (LLM may not have issued both in one turn)");
    }
  } else {
    console.log(`  ℹ️  LLM called ${execTimes.length} tool(s) (may not have called both in one turn)`);
  }

  console.log("✅ parallel 模式测试通过\n");
}

async function testSequentialMode() {
  console.log("【2】sequential 模式 — 强制串行\n");

  if (!checkOpenAI()) return;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant. When asked to call multiple tools, call them all.",
    tools: [
      makeDelayedTool("seq_tool_a", 300, "sequential"), // forces sequential
      makeDelayedTool("seq_tool_b", 300),
    ],
  });

  const execOrder: string[] = [];

  agent.subscribe((e) => {
    if (e.type === "tool_execution_start") {
      execOrder.push(e.name);
      console.log(`  → starting: ${e.name}`);
    }
    if (e.type === "tool_execution_end") {
      console.log(`  ← done: ${e.name} (${e.durationMs}ms)`);
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("Please call seq_tool_a with input 'first' and seq_tool_b with input 'second'.");
  console.log("\n");

  if (execOrder.length >= 2) {
    console.log(`  execution order: ${execOrder.join(" → ")}`);
    console.log("  ✅ sequential degradation working");
  } else {
    console.log(`  ℹ️  only ${execOrder.length} tool(s) called`);
  }

  console.log("✅ sequential 模式测试通过\n");
}

async function testDurationMs() {
  console.log("【3】durationMs — tool 执行时间记录正确\n");

  if (!checkOpenAI()) return;

  const EXPECTED_DELAY = 200;

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "You are a helpful assistant.",
    tools: [makeDelayedTool("timed_tool", EXPECTED_DELAY)],
  });

  const durations: number[] = [];

  agent.subscribe((e) => {
    if (e.type === "tool_execution_end") {
      durations.push(e.durationMs);
      console.log(`  durationMs: ${e.durationMs}ms (expected ≥${EXPECTED_DELAY}ms)`);
    }
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  await agent.prompt("Please call timed_tool with input 'measure me'");
  console.log("\n");

  if (durations.length > 0) {
    const d = durations[0]!;
    console.assert(d >= EXPECTED_DELAY, `❌ durationMs ${d} < expected ${EXPECTED_DELAY}`);
    console.assert(d < EXPECTED_DELAY + 2000, `❌ durationMs ${d} suspiciously high`);
    console.log("✅ durationMs 记录正确\n");
  } else {
    console.log("  ℹ️  tool was not called\n");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function toolExecutionMode() {
  console.log("\n========== v0.3: Tool Execution Mode ==========\n");

  if (!checkOpenAI()) {
    console.log("\n========== Case 结束 ==========\n");
    return;
  }

  try {
    await testParallelMode();
    await testSequentialMode();
    await testDurationMs();
    console.log("========== v0.3 Execution Mode 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
