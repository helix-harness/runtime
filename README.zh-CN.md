[English](./README.md) | [中文](./README.zh-CN.md)

# Helix Runtime

TypeScript 原生、Runtime First 的 AI Agent Harness SDK。

**Agent = Model + Harness**

Helix Runtime 提供 Agent 的执行层 —— 循环控制、工具编排、事件流、上下文管理 —— 让你专注于 Agent 做什么，而不是怎么跑。

## 为什么需要 Helix Runtime？

大多数 Agent 框架把"思考"和"执行"混在一起。Helix Runtime 划清了边界：

| 层 | 职责 | 谁来做 |
|---|---|---|
| **Model（思考层）** | 推理、生成、tool call 决策 | GPT / Claude / Gemini |
| **Harness（执行层）** | 循环控制、工具执行、状态管理、事件流 | **Helix Runtime** |

你提供模型和工具，Helix Runtime 负责跑循环。

## 快速开始

```bash
pnpm add @helix/runtime @helix/models @helix/core
```

```typescript
import { Agent } from "@helix/runtime";
import { getModel } from "@helix/models";

const agent = new Agent({
  model: getModel({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
  }),
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
});

// 订阅所有事件
agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

// 运行
await agent.prompt("Hello!");
```

### 无状态循环（低层 API）

```typescript
import { agentLoop } from "@helix/runtime";

const context = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
};

for await (const event of agentLoop([userMsg], context, { model })) {
  if (event.type === "message_update") process.stdout.write(event.delta);
  if (event.type === "agent_end") context.messages.push(...event.messages);
}
```

## 核心概念

### Agent 类

有状态封装，管理消息累积、取消控制和事件订阅。

```typescript
const agent = new Agent({
  model,                              // ModelAdapter
  systemPrompt: "You are helpful.",   // 系统提示词
  tools: [myTool],                    // ToolDef[]
  convertToLlm: (msgs) => msgs,      // 过滤发给 LLM 的消息
  transformContext: async (msgs) => { // 上下文裁剪/压缩
    return msgs.slice(-50);
  },
});

agent.subscribe(handler);  // 订阅事件
await agent.prompt("..."); // 发送用户消息
await agent.continue();    // 从当前上下文继续
agent.abort();             // 取消当前运行
agent.clearMessages();     // 重置状态
```

### Tool 系统

工具是带有 schema 和 execute 函数的普通对象：

```typescript
const calculator: ToolDef = {
  name: "calculator",
  description: "计算数学表达式",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "数学表达式" },
    },
    required: ["expression"],
  },
  execute: async (args) => {
    return { result: eval(args.expression) };
  },
};
```

执行模式：`parallel`（默认）或 `sequential`（在 tool 上设置 `executionMode: "sequential"`）。

### Sub-agent

将任意 `Agent` 包装为 Tool，实现 multi-agent 编排：

```typescript
import { createSubagentTool } from "@helix/runtime";

const specialist = new Agent({
  model,
  systemPrompt: "You are a domain specialist.",
  tools: [domainTool],
});

const orchestrator = new Agent({
  model,
  tools: [
    createSubagentTool({
      name: "specialist",
      description: "将任务委派给领域专家。",
      agent: specialist,
      onEvent: (e) => console.log("[specialist]", e.type),
    }),
  ],
});
```

### 上下文压缩

内置多种策略，防止对话上下文无限增长：

```typescript
import { sliceCompaction, tokenCompaction, summaryCompaction, compose } from "@helix/runtime";

// 按条数截断：保留最近 N 条
const agent = new Agent({
  model,
  transformContext: sliceCompaction({ keepLast: 20, triggerAt: 50 }),
});

// 按 token 截断：保留最近的 token 数
const agent = new Agent({
  model,
  transformContext: tokenCompaction({ keepRecentTokens: 2000, triggerAtTokens: 4000 }),
});

// LLM 摘要：用模型生成摘要替换旧消息
const agent = new Agent({
  model,
  transformContext: summaryCompaction({
    summaryModel: model,
    summaryInstructions: "用两句话总结对话。",
    triggerAtTokens: 4000,
  }),
});

// 组合：串联多个策略
const agent = new Agent({
  model,
  transformContext: compose(
    customPrune,
    sliceCompaction({ keepLast: 20, triggerAt: 50 }),
  ),
});
```

### Session 持久化

```typescript
import { MemorySessionStore, FileSessionStore } from "@helix/runtime";

// 内存存储（测试用）
const store = new MemorySessionStore();

// 文件存储（JSONL + meta）
const store = new FileSessionStore("./sessions");

const session = await store.create({ systemPrompt: "You are helpful." });
await store.save({ ...session, messages });
const loaded = await store.get(session.id);
```

## 事件系统

`agentLoop` 返回 `AsyncIterable<AgentEvent>`，所有行为均可观察：

```
agent_start
  turn_start
    message_start / message_end        (用户消息)
    message_start
      message_update (流式 delta)
    message_end                        (助手回复)
    tool_execution_start → tool_execution_end  (工具调用)
  turn_end
agent_end
```

## 架构

```
@helix/core        ← 零依赖共享类型（AgentMessage, ToolDef, ModelAdapter）
      ↑
@helix/runtime     ← Harness 核心（Agent, agentLoop, tools, compaction, session）
      ↑
@helix/models      ← LLM 适配器（OpenAI 兼容, Anthropic 兼容）
      ↑
你的 Agent          ← 消费 SDK
```

## Monorepo 结构

```text
packages/
├── core/          @helix/core     — 共享类型（零依赖）
├── runtime/       @helix/runtime  — Harness 核心
└── models/        @helix/models   — LLM 适配器

apps/
└── playground/    开发测试场
```

## 开发

```bash
pnpm install       # 安装依赖
pnpm build         # 构建所有包
pnpm dev           # Dev 模式（watch）
pnpm test          # 运行测试
pnpm typecheck     # 类型检查
pnpm lint          # 代码检查
```

运行指定的 playground case：

```bash
cd apps/playground
pnpm dev -- model-basic
```

## License

MIT
