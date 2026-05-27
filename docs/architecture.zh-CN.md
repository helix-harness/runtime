[English](./architecture.md) | [中文](./architecture.zh-CN.md)

# Helix Runtime — 架构文档

> 一个最小化、可扩展的 AI Agent Harness Runtime SDK。

---

## 1. 定位

```
@helix/runtime 是一个 Harness Runtime SDK。

不是 AI。不是 Agent 产品。
是让任何人都能快速构建 Agent 的执行层基础设施。
```

使用者拿到 SDK，配上 Model，即可组装出一个完整的 Agent：

```ts
import { Agent } from "@helix/runtime"
import { getModel } from "@helix/models"

const agent = new Agent({
  model: getModel({ model: "gpt-4o", apiKey: process.env.LLM_API_KEY }),
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
})

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta)
  }
})

await agent.prompt("帮我完成这个任务")
```

---

## 2. 核心概念

### 2.1 Agent = Model + Harness

```
Agent = Model + Harness
           ↑
  @helix/runtime 就是 Harness 的实现
```

| 层 | 职责 | 谁来做 |
|---|---|---|
| **Model（思考层）** | 推理、生成、tool call 决策 | GPT / Claude / Gemini |
| **Harness（执行层）** | 循环控制、工具执行、状态管理、事件流 | **@helix/runtime** |

### 2.2 Harness Runtime 负责

- Agent loop 控制（多轮对话、tool call 处理）
- Tool orchestration（注册、执行、并行/串行、错误处理）
- 消息转换（AgentMessage → LLM Message）
- Context 管理（剪枝、压缩）
- Event streaming（所有行为事件化）
- Loop 控制钩子（beforeToolCall、afterToolCall、shouldStopAfterTurn）
- 取消控制（AbortSignal）
- Session 持久化（内存 / 文件存储）

### 2.3 Harness Runtime 不负责

- 业务逻辑
- Prompt engineering
- Agent 产品设计
- 存储后端（内置 session store 之外的部分）

---

## 3. 包结构

### 3.1 包清单

| 包 | 定位 | 依赖 |
|---|---|---|
| `@helix/core` | 共享类型：AgentMessage, AgentContext, ToolDef, ModelAdapter | 零依赖 |
| `@helix/runtime` | Harness 核心：Agent, agentLoop, tools, compaction, session, events | `@helix/core` |
| `@helix/models` | LLM 适配器：OpenAI 兼容, Anthropic 兼容 | `@helix/core` |

### 3.2 依赖关系

```
@helix/core        （零依赖）
      ↑         ↑
@helix/runtime  @helix/models    （互不依赖，各自依赖 core）
      ↑
你的 Agent          （消费 SDK）
```

### 3.3 源码结构

```
packages/
├── core/src/
│   ├── message.ts          AgentMessage, ToolCallRef
│   ├── tool.ts             ToolDef, ToolResult
│   ├── context.ts          AgentContext
│   ├── adapter.ts          ModelAdapter, ModelChunk
│   └── index.ts
│
├── runtime/src/
│   ├── agent/agent.ts      Agent 类（有状态封装）
│   ├── loop/
│   │   ├── index.ts        agentLoop(), agentLoopContinue()
│   │   └── run.ts          runAgentLoop() 内部实现
│   ├── tool/
│   │   ├── ToolRegistry.ts 工具注册与查找
│   │   ├── ToolExecutor.ts 并行 / 串行执行
│   │   └── subagent.ts     createSubagentTool()
│   ├── compaction/index.ts sliceCompaction, tokenCompaction, summaryCompaction, compose
│   ├── session/index.ts    MemorySessionStore, FileSessionStore
│   ├── event/types.ts      AgentEvent 类型定义
│   └── index.ts
│
├── models/src/
│   ├── adapters/openai.ts  OpenAI 兼容适配器
│   ├── adapters/anthropic.ts Anthropic 兼容适配器
│   ├── getModel.ts         getModel() 工厂函数
│   └── index.ts
│
apps/
└── playground/src/cases/   15+ 测试用例，覆盖所有功能
```

---

## 4. 消息模型

### 4.1 AgentMessage vs LLM Message

这是 SDK 最重要的设计之一。

```
AgentMessage[]                     LLM Message[]
（应用层，可扩展）     convertToLlm()   （LLM 只认这个）
────────────────  ──────────────→  ─────────────────
user                               user
assistant                          assistant
toolResult                         toolResult
system            （过滤或保留）
custom_ui_msg     （过滤掉）
custom_app_msg    （转换）
```

`AgentMessage` 通过 TypeScript declaration merging 支持任意自定义角色。LLM 只理解标准角色。`convertToLlm` 是业务 agent 的核心扩展点。

### 4.2 完整消息管道

```
AgentMessage[]
    ↓
transformContext()      可选：剪枝旧消息、注入外部上下文（处理长对话）
    ↓
AgentMessage[]
    ↓
convertToLlm()          必须：过滤 UI-only 消息，转换自定义类型
    ↓
LLM Message[]
    ↓
ModelAdapter.stream()   调用 LLM
```

### 4.3 使用示例

```ts
const agent = new Agent({
  model,
  // 自定义消息转换：过滤掉 UI-only 消息
  convertToLlm: (messages) =>
    messages.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),

  // context 剪枝：只保留最近 50 条消息
  transformContext: async (messages) => messages.slice(-50),
})
```

---

## 5. 事件驱动架构

### 5.1 核心原则

```
所有 Harness 行为必须可事件化。
agentLoop 返回 AsyncIterable<AgentEvent>，消费方通过 for await 迭代。
```

### 5.2 事件生命周期

```
agent.prompt("任务")
├── agent_start
├── turn_start
│   ├── message_start     { userMessage }
│   ├── message_end       { userMessage }
│   ├── message_start     { assistantMessage }
│   ├── message_update    { delta }              ← 流式 token
│   ├── message_end       { assistantMessage }
│   ├── tool_execution_start  { name, args }     ← 如有 tool call
│   ├── tool_execution_end    { result, isError }
│   └── turn_end          { message, toolResults }
│
├── turn_start             ← tool 结果返回后 LLM 继续
│   └── ...
└── agent_end              { messages }
```

### 5.3 AgentEvent 类型

```ts
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end";              messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end";               message: AgentMessage; toolResults: ToolResult[] }
  | { type: "message_start";          message: AgentMessage }
  | { type: "message_update";         message: AgentMessage; delta: string }
  | { type: "message_end";            message: AgentMessage }
  | { type: "tool_execution_start";   toolCallId: string; name: string; args: unknown }
  | { type: "tool_execution_end";     toolCallId: string; name: string; result: unknown; isError: boolean; durationMs: number }
  | { type: "context_compacted";      tokensBefore: number; tokensAfter: number }
  | { type: "error";                  error: Error; fatal: boolean }
```

### 5.4 事件消费场景

| 能力 | 消费哪些事件 |
|---|---|
| UI 实时渲染 | `message_update`, `tool_execution_*` |
| Replay | 全部事件（按序列回放） |
| Debugger | 全部事件（断点在特定 type） |
| Observability | `turn_end`, `agent_end`, `error` |
| Tracing | 全部事件（按 sessionId 聚合） |

---

## 6. 核心 API

### 6.1 两种使用方式

**方式 A：Agent 类（推荐，有状态封装）**

```ts
const agent = new Agent({
  model,
  systemPrompt: "You are helpful.",
  tools: [myTool],
  convertToLlm: (msgs) => msgs.filter(m => ["user","assistant","toolResult"].includes(m.role)),
  transformContext: async (msgs) => msgs.slice(-50),
  beforeToolCall: async ({ name, args }) => "allow",         // 可阻断危险 tool
  afterToolCall: async ({ name, result, isError }) => {},    // 后处理
  shouldStopAfterTurn: async ({ toolResults }) => false,     // 控制 loop 是否继续
})

agent.subscribe(handler)
await agent.prompt("任务", { signal: abortController.signal })
await agent.continue()         // 从当前 context 继续（用于错误重试）
agent.abort()                  // 取消当前 loop
agent.clearMessages()          // 重置状态
```

**方式 B：agentLoop 函数（低层，无状态）**

```ts
const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
}

for await (const event of agentLoop(
  [{ role: "user", content: "任务", timestamp: Date.now() }],
  context,
  { model, signal: abortController.signal }
)) {
  if (event.type === "message_update") process.stdout.write(event.delta)
  if (event.type === "agent_end") {
    context.messages.push(...event.messages)  // 调用方自己管理 context
  }
}
```

### 6.2 关键类型

**AgentContext** — 无状态，每次调用 agentLoop 时传入：

```ts
interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDef[]
}
```

**ToolDef** — 工具定义，使用 JSON Schema 描述参数：

```ts
interface ToolDef<TArgs = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>        // JSON Schema
  execute: (args: TArgs) => Promise<unknown>
  executionMode?: "parallel" | "sequential"  // 默认 parallel
}
```

**ModelAdapter** — runtime 与 LLM 的接口契约：

```ts
interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk>
}

type ModelChunk =
  | { type: "text_delta";      value: string }
  | { type: "tool_call_delta"; toolCallId: string; name?: string; argsDelta: string }
  | { type: "tool_call";       toolCallId: string; name: string; args: unknown }
  | { type: "done" }
```

只有 `stream()` 方法，不区分 complete/stream，统一为 AsyncIterable。

---

## 7. Tool 系统

### 7.1 工具注册

```ts
const calculator: ToolDef = {
  name: "calculator",
  description: "计算数学表达式",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  execute: async (args) => {
    return { result: eval(args.expression) }
  },
}

const agent = new Agent({ model, tools: [calculator] })
```

### 7.2 执行模式

- **parallel**（默认）：同一轮的所有 tool call 并发执行
- **sequential**：在 tool 上设置 `executionMode: "sequential"`；如果批次中任一 tool 为 sequential，整批退化为串行

### 7.3 错误处理

Tool 执行失败不会中断 loop：
- `ToolResult.isError` 设为 `true`
- 错误消息作为 tool result 返回给 LLM
- 由 LLM 决定如何恢复

---

## 8. Multi-Agent（Sub-agent as Tool）

### 8.1 设计原则

```
Multi-agent ≠ 多个 agent 互相通信
Multi-agent = Agent as Tool（子 agent 作为父 agent 的 tool）
```

不引入额外的 orchestration 层，复用现有 tool 机制 —— 父 agent 通过调用 tool 来运行子 agent 的 loop。

### 8.2 实现方式

```ts
import { createSubagentTool } from "@helix/runtime"

const codeReviewAgent = new Agent({
  model: getModel({ provider: "anthropic-compatible", model: "claude-sonnet-4-20250514", apiKey }),
  systemPrompt: "You are a code review expert.",
  tools: [readFileTool],
})

const parentAgent = new Agent({
  model,
  systemPrompt: "You are a project manager.",
  tools: [
    createSubagentTool({
      name: "code_review",
      description: "委托代码审查专家审查代码",
      agent: codeReviewAgent,
      onEvent: (e) => console.log("[review]", e.type),
    }),
  ],
})

await parentAgent.prompt("审查 src/ 目录下所有文件的代码质量")
```

### 8.3 事件透传

子 agent 事件通过 `onEvent` 回调转发。父 agent 的订阅者可以观察子 agent 的活动，而不会混淆事件流。

---

## 9. 上下文压缩

### 9.1 问题

长对话 session 下 context 窗口会接近 token 上限，必须有截断/压缩策略。

### 9.2 内置策略

**sliceCompaction** — 超过阈值时保留最近 N 条消息：

```ts
transformContext: sliceCompaction({ keepLast: 20, triggerAt: 50 })
```

**tokenCompaction** — 按 token 数截断：

```ts
transformContext: tokenCompaction({ keepRecentTokens: 2000, triggerAtTokens: 4000 })
```

**summaryCompaction** — 用 LLM 对旧消息生成摘要：

```ts
transformContext: summaryCompaction({
  summaryModel: model,
  summaryInstructions: "用两句话总结对话。",
  triggerAtTokens: 4000,
})
```

**compose** — 组合多个策略：

```ts
transformContext: compose(
  customPrune,
  sliceCompaction({ keepLast: 20, triggerAt: 50 }),
)
```

### 9.3 机制

runtime 在每次 LLM 调用前执行 `transformContext`。如果转换后 token 数减少，会 emit `context_compacted` 事件。

---

## 10. Session 持久化

### 10.1 内置 Store

```ts
import { MemorySessionStore, FileSessionStore } from "@helix/runtime"

// 内存存储（测试用）
const store = new MemorySessionStore()

// 文件存储（每个 session 一个 JSONL + meta.json）
const store = new FileSessionStore("./sessions")
```

### 10.2 SessionStore 接口

```ts
interface SessionStore {
  create(opts?: { systemPrompt?: string; metadata?: Record<string, unknown> }): Promise<SessionData>
  get(id: string): Promise<SessionData | undefined>
  save(session: SessionData): Promise<void>
  list(): Promise<string[]>
  delete(id: string): Promise<void>
}
```

---

## 11. 取消控制（AbortSignal）

```ts
const controller = new AbortController()

// 用户点取消
cancelButton.onclick = () => controller.abort()

// 传给 agent
await agent.prompt("长任务", { signal: controller.signal })

// 或者传给底层 loop
for await (const event of agentLoop(msgs, context, { model, signal: controller.signal })) { ... }
```

AbortSignal 透传给：`ModelAdapter.stream()`、tool 执行、`transformContext`。abort 后 loop 立即退出，emit `agent_end`。

---

## 12. 架构分层

```
┌──────────────────────────────────────────────┐
│           业务 Agent 工程（独立 repo）         │
│   coding-agent / web-agent / custom-agent    │
│   消费 @helix/runtime SDK                    │
└──────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────┐
│             @helix/runtime                   │
│           (Harness / Kernel)                 │
│                                              │
│  Agent class ──→ agentLoop()                 │
│                    ↓                         │
│  convertToLlm  transformContext              │
│  beforeToolCall  afterToolCall               │
│  shouldStopAfterTurn  AbortSignal            │
│                    ↓                         │
│  ToolRegistry + ToolExecutor (parallel)      │
│  createSubagentTool (multi-agent)            │
│  sliceCompaction / tokenCompaction / summary │
│  MemorySessionStore / FileSessionStore       │
│                    ↓                         │
│  AsyncIterable<AgentEvent>                   │
└──────────────────────────────────────────────┘
          ↓                      ↓
   @helix/models           你的 Tools
          ↓                      ↓
         LLM               执行层
```

---

## 13. 设计原则

| 原则 | 内容 |
|---|---|
| Agent First | `Agent = Model + Harness`，AI 能力和执行控制分离 |
| Runtime First | 所有 agent 行为必须经过 runtime |
| Event First | 所有 runtime 行为必须可事件化，agentLoop 返回 AsyncIterable |
| Stateless Loop | `agentLoop` 是纯函数，Agent 类在上层做有状态封装 |
| No Premature Abstraction | 未出现真实需求前不引入复杂机制 |

**必须有的最小抽象：**

- Tool registry + executor（含并行模式）
- ModelAdapter interface
- convertToLlm + transformContext（消息转换层）
- AbortSignal（取消控制）
- beforeToolCall / afterToolCall / shouldStopAfterTurn（钩子）
- createSubagentTool（multi-agent 实现）

**禁止引入（直到真正需要）：**

- Agent 间通信协议
- Workflow engine / DSL
- Memory / RAG system
- Plugin system

---

## 14. 关键决策记录（ADR）

| # | 决策 | 结论 |
|---|---|---|
| 1 | agentLoop 返回类型 | `AsyncIterable<AgentEvent>`，streaming 和 event 统一 |
| 2 | AgentContext vs Session | 无状态 AgentContext，Agent 类在上层做有状态封装 |
| 3 | 消息转换层 | `convertToLlm`（必须）+ `transformContext`（可选），业务层扩展点 |
| 4 | ModelAdapter 接口 | 只有 `stream()`，不分 complete/stream，统一 AsyncIterable |
| 5 | Tool 执行失败 | `isError: true` 的 result 返回 LLM，emit `tool_execution_end`，不 abort |
| 6 | Tool 并行模式 | 默认 parallel，单 tool 可设 sequential，有 sequential tool 整批退化串行 |
| 7 | Multi-agent 实现 | Agent as Tool（`createSubagentTool`），复用 tool 机制，不引入 orchestration |
| 8 | Context Compaction | 通过 `transformContext` 钩子实现，runtime 提供内置策略但不强制 |
| 9 | 取消控制 | AbortSignal 透传给 model、tool、transformContext，abort 后 emit agent_end |
| 10 | Session 持久化 | 内置 MemorySessionStore 和 FileSessionStore；自定义 store 实现 SessionStore 接口 |
