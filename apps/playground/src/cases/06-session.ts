/**
 * Case 06: Session — 持久化存储
 *
 * 覆盖：
 *  1) MemorySessionStore — create / save / get / list / delete
 *  2) FileSessionStore — 跨进程恢复（重新实例化 store 仍可读取）
 *  3) FileSessionStore — JSONL 格式校验
 *
 * 不需要 LLM_API_KEY。
 */

import { MemorySessionStore, FileSessionStore } from "@helix/runtime";
import type { AgentMessage } from "@helix/core";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── 1) MemorySessionStore ──────────────────────────────────────────────────

async function testMemoryStore() {
  console.log("【1】MemorySessionStore — CRUD\n");

  const store = new MemorySessionStore();

  const session = await store.create({ systemPrompt: "You are helpful." });
  console.assert(session.id.startsWith("sess_"), "❌ id 格式不正确");
  console.assert(session.messages.length === 0, "❌ 初始 messages 应为空");

  const messages: AgentMessage[] = [
    { role: "user", content: "Hello", timestamp: Date.now() },
    { role: "assistant", content: "Hi!", timestamp: Date.now() },
  ];
  await store.save({ ...session, messages });

  const loaded = await store.get(session.id);
  console.assert(loaded?.messages.length === 2, "❌ messages 未持久化");

  const ids = await store.list();
  console.assert(ids.includes(session.id), "❌ list 未包含 session");

  await store.delete(session.id);
  console.assert((await store.get(session.id)) === undefined, "❌ 删除失败");

  console.log(`  id: ${session.id}`);
  console.log("✅ MemorySessionStore 通过\n");
}

// ─── 2) FileSessionStore — 跨实例恢复 ──────────────────────────────────────

async function testFileStore() {
  console.log("【2】FileSessionStore — 跨实例恢复\n");

  const dir = path.join(os.tmpdir(), `helix-session-${Date.now()}`);

  try {
    const store1 = new FileSessionStore(dir);

    const session = await store1.create({
      systemPrompt: "Test prompt",
      metadata: { env: "test" },
    });

    console.assert(
      fs.existsSync(path.join(dir, `${session.id}.meta.json`)),
      "❌ meta 文件未创建"
    );
    console.assert(
      fs.existsSync(path.join(dir, `${session.id}.jsonl`)),
      "❌ jsonl 文件未创建"
    );

    await store1.save({
      ...session,
      messages: [
        { role: "user", content: "What is 2+2?", timestamp: 1000 },
        { role: "assistant", content: "4", timestamp: 2000 },
        { role: "user", content: "And 3+3?", timestamp: 3000 },
        { role: "assistant", content: "6", timestamp: 4000 },
      ],
    });

    // 模拟跨进程：新建 store 实例读同一目录
    const store2 = new FileSessionStore(dir);
    const loaded = await store2.get(session.id);

    console.assert(loaded !== undefined, "❌ 跨实例未读到 session");
    console.assert(loaded!.systemPrompt === "Test prompt", "❌ systemPrompt 丢失");
    console.assert(loaded!.messages.length === 4, "❌ messages 数量不符");
    console.assert(
      (loaded!.metadata as any)?.env === "test",
      "❌ metadata 丢失"
    );

    await store2.delete(session.id);
    console.assert(
      !fs.existsSync(path.join(dir, `${session.id}.meta.json`)),
      "❌ 删除后 meta 文件仍存在"
    );

    console.log(`  dir: ${dir}`);
    console.log(`  id:  ${session.id}`);
    console.log("✅ FileSessionStore 通过\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 3) FileSessionStore — JSONL 格式 ──────────────────────────────────────

async function testJsonlFormat() {
  console.log("【3】FileSessionStore — JSONL 格式\n");

  const dir = path.join(os.tmpdir(), `helix-jsonl-${Date.now()}`);

  try {
    const store = new FileSessionStore(dir);
    const session = await store.create();

    await store.save({
      ...session,
      messages: [
        { role: "user", content: "line one", timestamp: 1 },
        { role: "assistant", content: "line two", timestamp: 2 },
      ],
    });

    const raw = fs.readFileSync(path.join(dir, `${session.id}.jsonl`), "utf8");
    const lines = raw.trim().split("\n");

    console.assert(lines.length === 2, `❌ 期望 2 行，实际 ${lines.length}`);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      console.assert("role" in parsed, "❌ 缺 role");
      console.assert("content" in parsed, "❌ 缺 content");
    }

    console.log(`  ${lines.length} lines, 每行合法 JSON`);
    console.log("✅ JSONL 格式通过\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function session() {
  console.log("\n========== 06 Session: 持久化存储 ==========\n");

  try {
    await testMemoryStore();
    await testFileStore();
    await testJsonlFormat();
    console.log("========== 06 Session 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ 失败:", err);
    throw err;
  }
}
