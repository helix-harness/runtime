/**
 * Case: Session Persistence (v0.6)
 *
 * 验证：
 * - MemorySessionStore: create / get / save / list
 * - FileSessionStore: 持久化到磁盘，模拟跨进程恢复
 * - 消息正确写入和读取
 */

import { MemorySessionStore, FileSessionStore } from "@helix/runtime";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentMessage } from "@helix/core";

// ─── MemorySessionStore ───────────────────────────────────────────────────────

async function testMemoryStore() {
  console.log("【1】MemorySessionStore\n");

  const store = new MemorySessionStore();

  // Create
  const session = await store.create({ systemPrompt: "You are helpful." });
  console.assert(session.id.startsWith("sess_"), "❌ invalid id format");
  console.assert(session.messages.length === 0, "❌ should start empty");

  // Save with messages
  const messages: AgentMessage[] = [
    { role: "user", content: "Hello", timestamp: Date.now() },
    { role: "assistant", content: "Hi there!", timestamp: Date.now() },
  ];
  await store.save({ ...session, messages });

  // Get
  const loaded = await store.get(session.id);
  console.assert(loaded?.messages.length === 2, "❌ messages not saved");
  console.assert(loaded?.messages[0]?.content === "Hello", "❌ wrong message content");

  // List
  const ids = await store.list();
  console.assert(ids.includes(session.id), "❌ session not in list");

  // Delete
  await store.delete(session.id);
  const deleted = await store.get(session.id);
  console.assert(deleted === undefined, "❌ session should be deleted");

  console.log(`  id: ${session.id}`);
  console.log("✅ MemorySessionStore 通过\n");
}

// ─── FileSessionStore ─────────────────────────────────────────────────────────

async function testFileStore() {
  console.log("【2】FileSessionStore — 磁盘持久化\n");

  const dir = path.join(os.tmpdir(), `helix-test-${Date.now()}`);

  try {
    const store = new FileSessionStore(dir);

    // Create
    const session = await store.create({ systemPrompt: "Test prompt", metadata: { env: "test" } });
    console.assert(fs.existsSync(path.join(dir, `${session.id}.meta.json`)), "❌ meta file not created");
    console.assert(fs.existsSync(path.join(dir, `${session.id}.jsonl`)), "❌ jsonl file not created");

    // Save with messages
    const messages: AgentMessage[] = [
      { role: "user", content: "What is 2+2?", timestamp: 1000 },
      { role: "assistant", content: "4", timestamp: 2000 },
      { role: "user", content: "And 3+3?", timestamp: 3000 },
      { role: "assistant", content: "6", timestamp: 4000 },
    ];
    await store.save({ ...session, messages });

    // Simulate process restart: create a new store instance pointing to same dir
    const store2 = new FileSessionStore(dir);
    const loaded = await store2.get(session.id);

    console.assert(loaded !== undefined, "❌ session not found after reload");
    console.assert(loaded!.systemPrompt === "Test prompt", "❌ systemPrompt not persisted");
    console.assert(loaded!.messages.length === 4, `❌ expected 4 messages, got ${loaded!.messages.length}`);
    console.assert(loaded!.messages[0]!.content === "What is 2+2?", "❌ wrong message content");
    console.assert((loaded!.metadata as any)?.env === "test", "❌ metadata not persisted");

    // List
    const ids = await store2.list();
    console.assert(ids.includes(session.id), "❌ session not in list");

    // Delete
    await store2.delete(session.id);
    const afterDelete = await store2.get(session.id);
    console.assert(afterDelete === undefined, "❌ should be deleted");
    console.assert(!fs.existsSync(path.join(dir, `${session.id}.meta.json`)), "❌ meta file still exists");

    console.log(`  dir: ${dir}`);
    console.log(`  id: ${session.id}`);
    console.log("✅ FileSessionStore 通过\n");
  } finally {
    // Cleanup
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testFileStoreJsonlFormat() {
  console.log("【3】FileSessionStore — JSONL 格式验证\n");

  const dir = path.join(os.tmpdir(), `helix-test-jsonl-${Date.now()}`);

  try {
    const store = new FileSessionStore(dir);
    const session = await store.create();

    const messages: AgentMessage[] = [
      { role: "user", content: "line one", timestamp: 1 },
      { role: "assistant", content: "line two", timestamp: 2 },
    ];
    await store.save({ ...session, messages });

    // Read raw JSONL file and verify format
    const jsonlPath = path.join(dir, `${session.id}.jsonl`);
    const raw = fs.readFileSync(jsonlPath, "utf8");
    const lines = raw.trim().split("\n");

    console.assert(lines.length === 2, `❌ expected 2 lines, got ${lines.length}`);

    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      console.assert("role" in parsed, "❌ missing role field");
      console.assert("content" in parsed, "❌ missing content field");
    }

    console.log(`  JSONL lines: ${lines.length}`);
    console.log(`  line 1: ${lines[0]}`);
    console.log("✅ JSONL 格式验证通过\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function sessionCase() {
  console.log("\n========== v0.6: Session Persistence ==========\n");

  try {
    await testMemoryStore();
    await testFileStore();
    await testFileStoreJsonlFormat();
    console.log("========== v0.6 全部通过 ✅ ==========\n");
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}
