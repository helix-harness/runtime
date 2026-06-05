/**
 * Case 08: Skills — 内存加载 & 文件加载
 *
 * 覆盖：
 *  1) 内存 Skill 构造（无 filePath）
 *  2) 构造时注入 skills 数组
 *  3) registerSkill() 动态注册
 *  4) SkillRegistry 验证（name 校验、description 必填）
 *  5) 文件加载 loadSkills() / loadSkillFromFile()
 *  6) invokeSkill() 调用（需要 LLM）
 */

import { Agent, SkillRegistry, loadSkillFromFile, formatSkillsForPrompt } from "@helixharness/runtime";
import type { Skill } from "@helixharness/core";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModel, checkEnv } from "./shared";

// ─── 1) 内存 Skill 构造 ──────────────────────────────────────────────────────

function testMemorySkill() {
  console.log("【1】内存 Skill — 无 filePath\n");

  const registry = new SkillRegistry();
  const skill: Skill = {
    name: "code-review",
    description: "审查代码质量与潜在问题",
    content: "请审查以下代码，关注：1) 潜在 bug 2) 性能问题 3) 可读性",
  };

  const diagnostics = registry.register(skill);
  console.log(`  注册 diagnostics: ${diagnostics.length}`);
  console.log(`  filePath: ${skill.filePath ?? "undefined"}`);
  console.assert(diagnostics.length === 0, "❌ 合法 skill 不应有 diagnostics");
  console.assert(registry.has("code-review"), "❌ skill 应已注册");
  console.assert(registry.get("code-review")?.filePath === undefined, "❌ filePath 应为 undefined");

  console.log("✅ 内存 Skill 构造通过\n");
}

// ─── 2) 构造时注入 skills 数组 ────────────────────────────────────────────────

function testSkillsInConstructor() {
  console.log("【2】Agent 构造时注入 skills\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个助手。",
    skills: [
      {
        name: "translate",
        description: "翻译文本为指定语言",
        content: "请将用户提供的文本翻译为目标语言。保留原始格式。",
      },
      {
        name: "summarize",
        description: "总结文本要点",
        content: "请用 3 个要点总结以下文本。",
      },
    ],
  });

  const skills = agent.listSkills();
  console.log(`  注册 skills: ${skills.length}`);
  console.assert(skills.length === 2, "❌ 应有 2 个 skill");
  console.assert(skills.some(s => s.name === "translate"), "❌ 应包含 translate");
  console.assert(skills.some(s => s.name === "summarize"), "❌ 应包含 summarize");

  // 验证 system prompt 包含 skill 信息
  const ctx = agent.getContext();
  console.assert(ctx.systemPrompt.includes("translate"), "❌ system prompt 应包含 translate");
  console.assert(ctx.systemPrompt.includes("summarize"), "❌ system prompt 应包含 summarize");
  console.assert(!ctx.systemPrompt.includes("<location>"), "❌ 内存 skill 不应有 location 标签");

  console.log("✅ 构造注入通过\n");
}

// ─── 3) registerSkill() 动态注册 ──────────────────────────────────────────────

function testDynamicRegistration() {
  console.log("【3】registerSkill() 动态注册\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个助手。",
  });

  console.assert(agent.listSkills().length === 0, "❌ 初始应无 skill");

  const diagnostics = agent.registerSkill({
    name: "debug-helper",
    description: "辅助调试代码问题",
    content: "请分析错误信息并给出修复建议。",
  });

  console.log(`  diagnostics: ${diagnostics.length}`);
  console.assert(diagnostics.length === 0, "❌ 不应有 diagnostics");
  console.assert(agent.listSkills().length === 1, "❌ 应有 1 个 skill");
  console.assert(agent.getSkill("debug-helper")?.description === "辅助调试代码问题", "❌ 描述不匹配");

  // 动态注册后 system prompt 应包含新 skill
  const ctx = agent.getContext();
  console.assert(ctx.systemPrompt.includes("debug-helper"), "❌ system prompt 应包含新 skill");
  console.assert(ctx.systemPrompt.includes("load_skill"), "❌ system prompt 应提示 load_skill");

  // 动态注册后 load_skill tool 应自动补注入
  console.assert(ctx.tools.some(t => t.name === "load_skill"), "❌ load_skill tool 应自动补注入");

  console.log("✅ 动态注册通过\n");
}

// ─── 4) SkillRegistry 验证 ───────────────────────────────────────────────────

function testValidation() {
  console.log("【4】SkillRegistry 验证\n");

  const registry = new SkillRegistry();

  // description 缺失 → 拒绝注册
  const d1 = registry.register({ name: "no-desc", description: "", content: "x" });
  console.log(`  空 description diagnostics: ${d1.length}`);
  console.assert(d1.some(d => d.code === "missing_description"), "❌ 应报 missing_description");
  console.assert(!registry.has("no-desc"), "❌ 缺 description 应拒绝注册");

  // name 不合法 → warning 但仍注册
  const d2 = registry.register({ name: "Bad_Name", description: "ok", content: "x" });
  console.log(`  非法 name diagnostics: ${d2.length}`);
  console.assert(d2.some(d => d.code === "invalid_name"), "❌ 应报 invalid_name");
  console.assert(registry.has("Bad_Name"), "❌ name 问题应 warning 但仍注册");

  // 合法 → 无 diagnostics
  const d3 = registry.register({ name: "good-skill", description: "all good", content: "x" });
  console.assert(d3.length === 0, "❌ 合法 skill 不应有 diagnostics");

  // registerAll 聚合 diagnostics
  const registry2 = new SkillRegistry();
  const all = registry2.registerAll([
    { name: "ok", description: "fine", content: "x" },
    { name: "bad", description: "", content: "x" },
  ]);
  console.log(`  registerAll diagnostics: ${all.length}`);
  console.assert(all.some(d => d.code === "missing_description"), "❌ 应聚合 diagnostics");
  console.assert(registry2.has("ok"), "❌ ok 应注册成功");
  console.assert(!registry2.has("bad"), "❌ bad 应被拒绝");

  console.log("✅ 验证通过\n");
}

// ─── 5) 文件加载 ──────────────────────────────────────────────────────────────

function testFileLoading() {
  console.log("【5】文件加载 loadSkillFromFile()\n");

  const dir = join(tmpdir(), `skill-case-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });

  try {
    const filePath = join(dir, "SKILL.md");
    writeFileSync(
      filePath,
      `---
name: file-skill
description: 从文件加载的 skill
---
这是文件中的指令内容。
请按照以下步骤执行。`
    );

    const result = loadSkillFromFile(filePath);
    console.assert(result.skill !== null, "❌ 应成功加载");
    console.assert(result.skill?.name === "file-skill", "❌ name 不匹配");
    console.assert(result.skill?.description === "从文件加载的 skill", "❌ description 不匹配");
    console.assert(result.skill?.content.includes("这是文件中的指令内容"), "❌ content 不匹配");
    console.assert(result.skill?.filePath === filePath, "❌ filePath 不匹配");
    console.assert(result.diagnostics.length === 0, "❌ 不应有 diagnostics");

    // filePath 降级为元数据，prompt 中不再输出 location
    const prompt = formatSkillsForPrompt([result.skill!]);
    console.assert(prompt.includes("load_skill"), "❌ 应提示 load_skill");
    console.assert(!prompt.includes("<location>"), "❌ 不应有 location 标签");

    console.log(`  文件: ${filePath}`);
    console.log(`  name: ${result.skill?.name}`);
    console.log("✅ 文件加载通过\n");
  } finally {
    rmSync(dir, { recursive: true });
  }
}

// ─── 6) invokeSkill() 调用 ───────────────────────────────────────────────────

async function testInvokeSkill() {
  console.log("【6】invokeSkill() — 内存 skill 调用\n");

  const agent = new Agent({
    model: createModel(),
    systemPrompt: "你是一个简洁的助手。",
    skills: [
      {
        name: "answer",
        description: "回答问题",
        content: "请直接回答用户的问题，不要多余解释。",
      },
    ],
  });

  agent.subscribe((e) => {
    if (e.type === "message_update") process.stdout.write(e.delta);
  });

  process.stdout.write("  → ");
  await agent.invokeSkill("answer", "1+1=? 只回答数字");
  console.log("\n");

  const messages = agent.getMessages();
  console.assert(messages.length >= 2, "❌ 应有 user + assistant 消息");

  console.log("✅ invokeSkill 通过\n");
}

// ─── 7) formatSkillsForPrompt 统一 load_skill ────────────────────────────────

function testPromptFormatting() {
  console.log("【7】formatSkillsForPrompt — 统一 load_skill\n");

  const memorySkill: Skill = {
    name: "mem",
    description: "内存 skill",
    content: "content",
  };
  const fileSkill: Skill = {
    name: "file",
    description: "文件 skill",
    content: "content",
    filePath: "/path/to/SKILL.md",
  };

  const memPrompt = formatSkillsForPrompt([memorySkill]);
  const filePrompt = formatSkillsForPrompt([fileSkill]);

  // 统一使用 load_skill，不再输出 <location>
  console.assert(!memPrompt.includes("<location>"), "❌ 不应有 location");
  console.assert(!filePrompt.includes("<location>"), "❌ 不应有 location");
  console.assert(memPrompt.includes("load_skill"), "❌ 应提示 load_skill");
  console.assert(filePrompt.includes("load_skill"), "❌ 应提示 load_skill");
  console.assert(memPrompt.includes("<name>mem</name>"), "❌ 应包含 skill name");
  console.assert(filePrompt.includes("<name>file</name>"), "❌ 应包含 skill name");

  // 空数组
  console.assert(formatSkillsForPrompt([]) === "", "❌ 空数组应返回空字符串");

  console.log("✅ Prompt 格式化通过\n");
}

// ─── 8) load_skill tool 自动注入 ─────────────────────────────────────────────

function testLoadSkillTool() {
  console.log("【8】load_skill tool — 自动注入\n");

  // 有 skill 时自动注入 load_skill tool
  const agentWithSkills = new Agent({
    model: createModel(),
    systemPrompt: "你是一个助手。",
    skills: [{ name: "test", description: "test skill", content: "instructions" }],
  });
  const tools = agentWithSkills.getContext().tools;
  const loadSkillTool = tools.find(t => t.name === "load_skill");
  console.log(`  tools 数量: ${tools.length}`);
  console.assert(loadSkillTool !== undefined, "❌ 有 skill 时应自动注入 load_skill tool");
  console.assert(loadSkillTool?.parameters.required?.includes("name"), "❌ load_skill 应要求 name 参数");

  // 无 skill 时不注入
  const agentNoSkills = new Agent({
    model: createModel(),
    systemPrompt: "你是一个助手。",
  });
  console.assert(
    agentNoSkills.getContext().tools.find(t => t.name === "load_skill") === undefined,
    "❌ 无 skill 时不应注入 load_skill tool"
  );

  // 用户自定义 tool 不被覆盖
  const agentWithCustom = new Agent({
    model: createModel(),
    systemPrompt: "你是一个助手。",
    tools: [{ name: "my_tool", description: "custom", parameters: { type: "object" as const, properties: {} }, execute: async () => ({}) }],
    skills: [{ name: "test", description: "test", content: "content" }],
  });
  const allTools = agentWithCustom.getContext().tools;
  console.assert(allTools.some(t => t.name === "my_tool"), "❌ 用户自定义 tool 应保留");
  console.assert(allTools.some(t => t.name === "load_skill"), "❌ load_skill 应追加");

  console.log("✅ load_skill tool 注入通过\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function skills() {
  console.log("\n========== 08 Skills: 内存加载 & 文件加载 ==========\n");

  // 无需 LLM 的测试
  testMemorySkill();
  testValidation();
  testPromptFormatting();
  testFileLoading();
  testLoadSkillTool();

  // 需要 LLM 的测试
  if (!checkEnv()) {
    console.log("跳过需要 LLM 的测试（LLM_API_KEY 未设置）\n");
    return;
  }

  testSkillsInConstructor();
  testDynamicRegistration();
  await testInvokeSkill();

  console.log("========== 08 Skills 全部通过 ✅ ==========\n");
}
