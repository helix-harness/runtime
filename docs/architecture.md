# @helix/runtime

> A minimal, extensible Harness Runtime SDK for building AI Agents.

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
  model: getModel("openai", "gpt-4o"),
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

| 层                | 职责                                   | 谁来做                |
| ----------------- | -------------------------------------- | --------------------- |
| Model（思考层）   | 推理、生成、tool call decision         | GPT / Claude / Gemini |
| Harness（执行层） | loop 控制、tool 执行、状态管理、事件流 | **@helix/runtime**    |

### 2.2 Harness Runtime 负责

- Agent loop 控制（多轮对话、tool call 处理）
- Tool orchestration（注册、执行、并行/串行、错误处理）
- 消息转换（AgentMessage → LLM Message）
- Context 管理（剪枝、压缩）
- Event streaming（所有行为事件化）
- Loop 控制钩子（beforeToolCall、afterToolCall、shouldStopAfterTurn）
- 取消控制（AbortSignal）

### 2.3 Harness Runtime 不负责

- ❌ 业务逻辑
- ❌ Prompt engineering
- ❌ Agent 产品设计
- ❌ 持久化存储

---

## 3. 消息模型（关键设计）

### 3.1 AgentMessage vs LLM Message

这是 SDK 最重要的设计之一。

```
AgentMessage[]                     LLM Message[]
(应用层，可扩展)     convertToLlm()   (LLM 只认这个)
────────────────  ──────────────→  ─────────────────
user                               user
assistant                          assistant
toolResult                         toolResult
system            (过滤掉)
custom_ui_msg     (过滤掉)
custom_app_msg    (转换)
```

`AgentMessage` 可以包含任意自定义类型（通过 TypeScript declaration merging 扩展），LLM 只理解标准的三种角色。`convertToLlm` 是业务 agent 的核心扩展点，负责过滤和转换。

### 3.2 消息流完整链路

```
AgentMessage[]
    ↓
transformContext()     ← 可选：剪枝旧消息、注入外部 context（处理 long session）
    ↓
AgentMessage[]
    ↓
convertToLlm()         ← 必须：过滤 UI-only 消息，转换自定义类型
    ↓
LLM Message[]
    ↓
ModelAdapter.stream()  ← 调用 LLM
```

### 3.3 业务 agent 使用示例

```ts
const agent = new Agent({
  model,
  // 自定义消息转换：过滤掉 UI-only 消息
  convertToLlm: (messages) =>
    messages.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),

  // context 剪枝：只保留最近 50 条消息，处理 long session
  transformContext: async (messages) => messages.slice(-50),
})
```

---

## 4. Event-Driven

```
所有 Harness 行为必须可事件化。
agentLoop 返回 AsyncIterable<AgentEvent>，消费方通过 for await 迭代。
```

### 4.1 事件生命周期

```
agent.prompt("任务")
├─ agent_start
├─ turn_start
│   ├─ message_start    { userMessage }
│   ├─ message_end      { userMessage }
│   ├─ message_start    { assistantMessage }
│   ├─ message_update   { delta }              ← streaming token
│   ├─ message_end      { assistantMessage }
│   ├─ tool_execution_start  { name, args }    ← 如有 tool call
│   ├─ tool_execution_update { partial }       ← 如果 tool 支持流式
│   ├─ tool_execution_end    { result, isError }
│   ├─ message_start/end { toolResultMessage }
│   └─ turn_end         { message, toolResults }
│
├─ turn_start            ← tool 后继续下一轮
│   └─ ...
└─ agent_end             { messages }
```

### 4.2 AgentEvent 类型

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
  | { type: "tool_execution_update";  toolCallId: string; partial: unknown }
  | { type: "tool_execution_end";     toolCallId: string; result: unknown; isError: boolean; durationMs: number }
  | { type: "context_compacted";      tokensBefore: number; tokensAfter: number }
  | { type: "error";                  error: Error; fatal: boolean }
```

### 4.3 未来基于 Event System 构建的能力

| 能力          | 消费哪些事件                         |
| ------------- | ------------------------------------ |
| UI 实时渲染   | `message_update`, `tool_execution_*` |
| Replay        | 全部事件（按 `seq` 回放）            |
| Debugger      | 全部事件（断点在特定 type）          |
| Observability | `turn_end`, `agent_end`, `error`     |
| Tracing       | 全部事件（按 `sessionId` 聚合）      |

---

## 5. 核心 API

### 5.1 两种使用方式

**方式 A：Agent 类（推荐，有状态封装）**

```ts
const agent = new Agent({
  model: getModel("openai", "gpt-4o"),
  systemPrompt: "You are helpful.",
  tools: [myTool],
  convertToLlm: (msgs) => msgs.filter(m => ["user","assistant","toolResult"].includes(m.role)),
  transformContext: async (msgs) => msgs.slice(-50),         // 处理 long session
  beforeToolCall: async ({ name, args }) => "allow",         // 可阻断危险 tool
  afterToolCall: async ({ name, result, isError }) => {},    // 后处理
  shouldStopAfterTurn: async ({ toolResults }) => false,     // 控制 loop 是否继续
})

agent.subscribe(handler)
await agent.prompt("任务", { signal: abortController.signal })
await agent.continue()         // 从当前 context 继续（用于错误重试）
agent.abort()                  // 主动取消当前 loop
```

**方式 B：agentLoop 函数（低层，无状态）**

```ts
const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
}

const stream = agentLoop(
  [{ role: "user", content: "任务", timestamp: Date.now() }],
  context,
  {
    model: getModel("openai", "gpt-4o"),
    convertToLlm: (msgs) => msgs.filter(...),
    signal: abortController.signal,
  }
)

for await (const event of stream) {
  if (event.type === "message_update") process.stdout.write(event.delta)
  if (event.type === "agent_end") {
    context.messages.push(...event.messages)  // 调用方自己管理 context
  }
}
```

### 5.2 ToolDef

```ts
type ToolDef<TArgs = unknown> = {
  name: string
  description: string
  parameters: Record<string, unknown>          // JSON Schema
  execute: (args: TArgs) => Promise<ToolResult | { terminate: true }>
  executionMode?: "parallel" | "sequential"   // 默认 parallel
}
```

`execute` 返回 `{ terminate: true }` 时，runtime 跳过本轮的后续 LLM 调用，直接结束 loop。

### 5.3 AgentContext

```ts
type AgentContext = {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDef[]
}
```

stateless，每次 `agentLoop` 传入，由调用方管理生命周期。

### 5.4 ModelAdapter

```ts
interface ModelAdapter {
  stream(
    messages: Message[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk>
}

type ModelChunk =
  | { type: "text_delta";  value: string }
  | { type: "tool_call";   id: string; name: string; args: unknown }
  | { type: "done" }
```

只有 `stream()` 方法，不区分 complete/stream，统一为 AsyncIterable。

---

## 6. Multi-Agent（Sub-agent as Tool）

### 6.1 设计原则

```
Multi-agent ≠ 多个 agent 互相通信
Multi-agent = Agent as Tool（子 agent 作为父 agent 的 tool）
```

不引入额外的 orchestration 层，复用现有 tool 机制，父 agent 通过调用 tool 来调度子 agent。

### 6.2 实现方式

```ts
import { createSubagentTool } from "@helix/runtime"

// 子 agent：专注于代码审查
const codeReviewAgent = new Agent({
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  systemPrompt: "You are a code review expert.",
  tools: [readFileTool],
})

// 把子 agent 包装成 tool，注册到父 agent
const parentAgent = new Agent({
  model: getModel("openai", "gpt-4o"),
  systemPrompt: "You are a project manager.",
  tools: [
    createSubagentTool({
      name: "code_review",
      description: "委托代码审查专家审查代码",
      agent: codeReviewAgent,
    }),
    otherTool,
  ],
})

await parentAgent.prompt("审查 src/ 目录下所有文件的代码质量")
```

### 6.3 子 agent 事件透传

子 agent 执行时，事件通过 `tool_execution_update` 向父 agent 透传，消费方可以区分来源：

```ts
parentAgent.subscribe((event) => {
  if (event.type === "tool_execution_update" && event.toolCallId.startsWith("subagent:")) {
    // 子 agent 的事件
  }
})
```

---

## 7. Context Compaction（长对话管理）

### 7.1 问题

长 session 下 context 窗口会接近上限，必须有截断/压缩策略。

### 7.2 两种策略

**策略 A：简单截断（`transformContext`）**

```ts
const agent = new Agent({
  model,
  // 只保留 systemPrompt + 最近 N 条消息
  transformContext: async (messages) => {
    const recent = messages.slice(-30)
    return recent
  },
})
```

**策略 B：LLM 摘要压缩（`transformContext` + LLM 调用）**

```ts
const agent = new Agent({
  model,
  transformContext: async (messages, signal) => {
    if (estimateTokens(messages) < TOKEN_THRESHOLD) return messages

    // 用 LLM 对历史消息做摘要
    const summary = await summarize(messages.slice(0, -10), { signal })
    return [
      { role: "system", content: `历史摘要：${summary}`, timestamp: Date.now() },
      ...messages.slice(-10),  // 保留最近 10 条原始消息
    ]
  },
})
```

runtime 在每次 LLM 调用前执行 `transformContext`，执行后 emit `context_compacted` 事件。

---

## 8. 取消控制（AbortSignal）

```ts
const controller = new AbortController()

// 用户点取消
cancelButton.onclick = () => controller.abort()

// 传给 agent
await agent.prompt("长任务", { signal: controller.signal })

// 或者传给底层 loop
const stream = agentLoop(msgs, context, { model, signal: controller.signal })
```

AbortSignal 会透传给：ModelAdapter.stream()、tool 执行、transformContext。abort 后 loop 立即退出，emit `agent_end`。

---

## 9. SDK 接入指南

> 这一章面向使用 `@helix/runtime` 开发业务 agent 的开发者。

### 9.1 最简接入（5 行代码）

```ts
import { Agent } from "@helix/runtime"
import { getModel } from "@helix/models"

const agent = new Agent({ model: getModel("openai", "gpt-4o") })
agent.subscribe(e => { if (e.type === "message_update") process.stdout.write(e.delta) })
await agent.prompt("你好")
```

### 9.2 添加自定义 Tool

```ts
const myTool: ToolDef = {
  name: "search_database",
  description: "搜索业务数据库",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const results = await db.search(query)
    return { results }
  },
}

const agent = new Agent({ model, tools: [myTool] })
```

### 9.3 扩展自定义消息类型

```ts
// 声明自定义消息类型（TypeScript declaration merging）
declare module "@helix/core" {
  interface AgentMessageTypes {
    "ui_notification": { text: string; level: "info" | "warn" }
  }
}

// 在 convertToLlm 中过滤掉，LLM 不需要看到
const agent = new Agent({
  model,
  convertToLlm: (msgs) => msgs.filter(m => m.role !== "ui_notification"),
})

// 业务层可以自由插入这类消息
agent.insertMessage({ role: "ui_notification", text: "任务开始", level: "info" })
```

### 9.4 处理 Long Session

```ts
const agent = new Agent({
  model,
  transformContext: async (messages, signal) => {
    // 简单策略：超过 100 条就截断
    if (messages.length <= 100) return messages
    return messages.slice(-80)    // 保留最近 80 条
  },
})
```

### 9.5 Tool 执行拦截

```ts
const agent = new Agent({
  model,
  tools: [deleteFileTool, readFileTool],

  // 危险操作需要确认
  beforeToolCall: async ({ name, args }) => {
    if (name === "delete_file") {
      const confirmed = await askUserConfirmation(`确认删除 ${args.path}？`)
      return confirmed ? "allow" : "block"
    }
    return "allow"
  },
})
```

### 9.6 事件消费（UI 集成）

```ts
const agent = new Agent({ model, tools })

// UI 实时更新
agent.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      ui.appendText(event.delta)
      break
    case "tool_execution_start":
      ui.showToolBadge(event.name)
      break
    case "tool_execution_end":
      ui.hideToolBadge(event.name)
      break
    case "agent_end":
      ui.setDone()
      break
  }
})
```

### 9.7 接入自定义 Model

```ts
import type { ModelAdapter, ModelChunk } from "@helix/core"

class MyCustomAdapter implements ModelAdapter {
  async *stream(messages, { tools, signal }): AsyncIterable<ModelChunk> {
    // 调用自己的 LLM API
    const response = await myLLMAPI.chat(messages, { signal })
    for await (const chunk of response) {
      yield { type: "text_delta", value: chunk.text }
    }
    yield { type: "done" }
  }
}

const agent = new Agent({ model: new MyCustomAdapter() })
```

---

## 10. SDK 包结构

### 10.1 包清单

| Package          | 定位                                                         | 阶段 |
| ---------------- | ------------------------------------------------------------ | ---- |
| `@helix/core`    | 共享类型：AgentMessage, AgentContext, ToolDef, ModelAdapter interface，零依赖 | v0.1 |
| `@helix/runtime` | Harness 核心（agentLoop、Agent 类、tool、event）             | v0.1 |
| `@helix/models`  | LLM adapters（OpenAI、Anthropic 等）                         | v0.1 |
| `@helix/tools`   | 内置 tool ecosystem（tool 数量增长后拆出）                   | 按需 |
| `@helix/sandbox` | Execution isolation（安全隔离）                              | 按需 |

### 10.2 包依赖关系

```
@helix/core        ← 零依赖
      ↑         ↑
@helix/runtime  @helix/models   ← 互不依赖，各自依赖 core
      ↑
业务 agent 工程    ← 消费 SDK，独立 repo
```

### 10.3 Monorepo 结构

```
helix-harness/runtime/
├── packages/
│   ├── core/               # @helix/core
│   │   └── src/
│   │       ├── types/
│   │       │   ├── message.ts      # AgentMessage
│   │       │   ├── context.ts      # AgentContext
│   │       │   ├── tool.ts         # ToolDef, ToolResult
│   │       │   └── event.ts        # AgentEvent
│   │       ├── adapters/
│   │       │   └── model.ts        # ModelAdapter interface
│   │       └── index.ts
│   │
│   ├── runtime/            # @helix/runtime
│   │   └── src/
│   │       ├── loop/
│   │       │   ├── index.ts        # agentLoop(), agentLoopContinue()
│   │       │   └── run.ts          # runAgentLoop() 内部实现
│   │       ├── tool/
│   │       │   ├── ToolRegistry.ts
│   │       │   ├── ToolExecutor.ts # parallel / sequential 模式
│   │       │   └── subagent.ts     # createSubagentTool()
│   │       ├── agent/
│   │       │   └── Agent.ts        # 有状态封装
│   │       ├── context/
│   │       │   └── compaction.ts   # transformContext 调用时机
│   │       └── index.ts            # export: Agent, agentLoop, agentLoopContinue, createSubagentTool
│   │
│   └── models/             # @helix/models
│       └── src/
│           ├── openai/
│           ├── anthropic/
│           └── index.ts            # getModel()
│
├── apps/
│   └── playground/
│       └── src/cases/
│           ├── basic.ts            # 验证 agent.prompt()
│           ├── tool-call.ts        # 验证 tool execution
│           ├── hooks.ts            # 验证 beforeToolCall 拦截
│           ├── subagent.ts         # 验证 sub-agent as tool
│           ├── compaction.ts       # 验证 context compaction
│           └── event-sequence.ts  # 验证事件序列完整性
│
├── docs/
│   ├── quick-start.md
│   ├── tools.md
│   ├── events.md
│   ├── multi-agent.md
│   └── compaction.md
├── examples/
│   ├── basic-agent/
│   ├── tool-agent/
│   └── multi-agent/
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 11. 架构分层

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
│                    ↓                         │
│  AsyncIterable<AgentEvent>                   │
└──────────────────────────────────────────────┘
          ↓                      ↓
   @helix/models            @helix/tools
          ↓                      ↓
         LLM               Execution Layer
```

---

## 12. 设计原则

| 原则                     | 内容                                                        |
| ------------------------ | ----------------------------------------------------------- |
| Agent First              | `Agent = Model + Harness`，AI 能力和执行控制分离            |
| Runtime First            | 所有 agent 行为必须经过 runtime                             |
| Event First              | 所有 runtime 行为必须可事件化，agentLoop 返回 AsyncIterable |
| Stateless Loop           | `agentLoop` 是纯函数，Agent 类在上层做有状态封装            |
| No Premature Abstraction | 未出现真实需求前不引入复杂机制                              |

**必须有的最小抽象：**

- ✅ Tool registry + executor（含并行模式）
- ✅ Model adapter interface
- ✅ convertToLlm + transformContext（消息转换层）
- ✅ AbortSignal（取消控制）
- ✅ beforeToolCall / afterToolCall / shouldStopAfterTurn
- ✅ createSubagentTool（multi-agent 的正确实现方式）

**禁止引入（直到真正需要）：**

- ❌ Agent 间通信协议
- ❌ Workflow engine / DSL
- ❌ Memory / RAG system
- ❌ Plugin system

---

## 13. 关键决策记录（ADR）

| #    | 决策                    | 结论                                                         |
| ---- | ----------------------- | ------------------------------------------------------------ |
| 1    | agentLoop 返回类型      | `AsyncIterable<AgentEvent>`，streaming 和 event 统一         |
| 2    | AgentContext vs Session | stateless AgentContext，Agent 类上层做有状态封装             |
| 3    | 消息转换层              | `convertToLlm`（必须）+ `transformContext`（可选），业务层扩展点 |
| 4    | ModelAdapter 接口       | 只有 `stream()`，不分 complete/stream，统一 AsyncIterable    |
| 5    | Tool 执行失败           | `isError: true` 的 result 返回 LLM，emit `tool_execution_end`，不 abort |
| 6    | Tool 并行模式           | 默认 parallel，单 tool 可设 sequential，有 sequential tool 整批退化串行 |
| 7    | Multi-agent 实现        | Agent as Tool（`createSubagentTool`），复用 tool 机制，不引入 orchestration |
| 8    | Context Compaction      | 通过 `transformContext` 钩子实现，runtime 不内置压缩策略     |
| 9    | 取消控制                | AbortSignal 透传给 model、tool、transformContext，abort 后 emit agent_end |
| 10   | @helix/tools 独立时机   | tool 数量 > 10 时才拆，v0.1 作为 runtime 内部模块            |
| 11   | 业务 agent 工程位置     | SDK 发布后独立 repo 消费；开发阶段在 monorepo apps/ 下       |