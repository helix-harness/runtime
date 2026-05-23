# @helix/runtime — 版本路线图

> 每个版本只做一件事，做完能跑，能验证，再进下一个。

---

## 总览

```
v0.1  基础骨架
  v0.1.1  monorepo 初始化
  v0.1.2  核心类型 + ModelAdapter interface
  v0.1.3  OpenAIAdapter（streaming）
  v0.1.4  agentLoop — AsyncIterable<AgentEvent>，单轮
  v0.1.5  Agent 类封装

v0.2  消息转换层
  v0.2.1  convertToLlm
  v0.2.2  transformContext（context 剪枝）
  v0.2.3  完整 AgentEvent 类型 + 事件序列验证

v0.3  Tool Calling
  v0.3.1  ToolDef + ToolRegistry
  v0.3.2  ToolExecutor（执行 + 错误处理）
  v0.3.3  agentLoop 多轮 + tool_execution_* 事件

v0.4  Loop 控制
  v0.4.1  AbortSignal（取消控制）
  v0.4.2  beforeToolCall + afterToolCall
  v0.4.3  shouldStopAfterTurn + terminate

v0.5  并行 Tool 执行
  v0.5.1  parallel 模式
  v0.5.2  per-tool executionMode

v0.6  Sub-agent（Multi-agent）
  v0.6.1  createSubagentTool
  v0.6.2  子 agent 事件透传

v0.7  Context Compaction
  v0.7.1  token 估算工具
  v0.7.2  compaction 触发时机 + context_compacted 事件
  v0.7.3  LLM 摘要压缩示例

v1.0  稳定发布
  v1.0.1  API review + 类型导出整理
  v1.0.2  docs/ + examples/
  v1.0.3  CI/CD + npm 发布
```

---

## v0.1 — 基础骨架

### v0.1.1 — Monorepo 初始化

**目标：项目跑起来，全部能 build。**

做什么：

- 初始化 pnpm workspace
- 建三个空包：`core` / `runtime` / `models` + `apps/playground`
- 配置 `turbo.json`、`tsconfig.base.json`

验证：

```bash
pnpm install && pnpm build   # 全部通过
```

---

### v0.1.2 — 核心类型 + ModelAdapter Interface

**目标：定义整个 SDK 的类型基础，在 `@helix/core` 中一次性建好。**

做什么：

```ts
// types/message.ts
export type AgentMessage = {
  role: "user" | "assistant" | "toolResult" | "system" | string  // string 允许自定义类型
  content: string
  timestamp: number
  toolCallId?: string
}

// types/context.ts
export type AgentContext = {
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDef[]
}

// types/tool.ts
export type ToolDef<TArgs = unknown> = {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: TArgs) => Promise<unknown>
  executionMode?: "parallel" | "sequential"
}

export type ToolResult = {
  toolCallId: string
  content: string
  isError: boolean
  durationMs: number
}

// types/event.ts
export type AgentEvent =
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

// adapters/model.ts
export type ModelChunk =
  | { type: "text_delta"; value: string }
  | { type: "tool_call";  id: string; name: string; args: unknown }
  | { type: "done" }

export interface ModelAdapter {
  stream(
    messages: AgentMessage[],
    opts: { tools?: ToolDef[]; signal?: AbortSignal }
  ): AsyncIterable<ModelChunk>
}
```

验证：

```bash
pnpm typecheck   # core 类型检查通过
```

---

### v0.1.3 — OpenAIAdapter 实现

**目标：能真实调用 OpenAI，返回流式 chunk。**

做什么（`@helix/models`）：

```ts
export class OpenAIAdapter implements ModelAdapter {
  constructor(private opts: { apiKey: string; model?: string }) {}

  async *stream(messages, { tools, signal }): AsyncIterable<ModelChunk> {
    // 调用 OpenAI streaming API
    // yield { type: "text_delta", value: chunk }
    // yield { type: "tool_call", id, name, args }
    // yield { type: "done" }
  }
}

export function getModel(provider: "openai" | "anthropic", model: string): ModelAdapter
```

验证：

```ts
// playground/cases/adapter.ts
const adapter = new OpenAIAdapter({ apiKey })
for await (const chunk of adapter.stream([{ role: "user", content: "1+1=?", timestamp: 0 }], {})) {
  if (chunk.type === "text_delta") process.stdout.write(chunk.value)
}
```

---

### v0.1.4 — agentLoop（单轮，AsyncIterable）

**目标：核心函数，事件从第一天就是流式。**

做什么（`@helix/runtime`）：

```ts
// loop/index.ts
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: {
    model: ModelAdapter
    convertToLlm?: (messages: AgentMessage[]) => AgentMessage[]
    signal?: AbortSignal
  }
): AsyncIterable<AgentEvent>

export function agentLoopContinue(
  context: AgentContext,
  config: { model: ModelAdapter; signal?: AbortSignal }
): AsyncIterable<AgentEvent>
```

v0.1 只实现单轮（无 tool_call 处理），内部流程：

```
yield agent_start
yield turn_start
yield message_start (user)
yield message_end (user)
yield message_start (assistant)
for await chunk of model.stream():
  yield message_update { delta }
yield message_end (assistant)
yield turn_end
yield agent_end
```

验证：

```ts
// playground/cases/basic.ts
const events: string[] = []
const context: AgentContext = { systemPrompt: "helpful", messages: [], tools: [] }

for await (const e of agentLoop([{ role: "user", content: "你好", timestamp: 0 }], context, { model: adapter })) {
  events.push(e.type)
  if (e.type === "message_update") process.stdout.write(e.delta)
}

console.log(events)
// ["agent_start","turn_start","message_start","message_end","message_start","message_update",...,"message_end","turn_end","agent_end"]
```

---

### v0.1.5 — Agent 类封装

**目标：有状态的 Agent，messages 自动累积，subscribe API 简洁。**

做什么：

```ts
// agent/Agent.ts
export class Agent {
  constructor(opts: {
    model: ModelAdapter
    systemPrompt?: string
    tools?: ToolDef[]
    convertToLlm?: (msgs: AgentMessage[]) => AgentMessage[]
    transformContext?: (msgs: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
    beforeToolCall?: (ctx: { name: string; args: unknown }) => Promise<"allow" | "block"> | "allow" | "block"
    afterToolCall?: (ctx: { name: string; result: unknown; isError: boolean }) => Promise<void> | void
    shouldStopAfterTurn?: (ctx: { message: AgentMessage; toolResults: ToolResult[] }) => Promise<boolean> | boolean
  })

  subscribe(handler: (e: AgentEvent) => void): () => void    // 返回 unsubscribe
  async prompt(input: string, opts?: { signal?: AbortSignal }): Promise<void>
  async continue(opts?: { signal?: AbortSignal }): Promise<void>
  abort(): void
  getMessages(): AgentMessage[]
  clearMessages(): void
}
```

v0.1.5 只实现构造、subscribe、prompt、getMessages，钩子留空（v0.4 实现）。

验证：

```ts
// playground/cases/agent-basic.ts
const agent = new Agent({ model: adapter })
agent.subscribe(e => { if (e.type === "message_update") process.stdout.write(e.delta) })
await agent.prompt("你好")
await agent.prompt("你记得我说了什么吗")   // 验证 messages 累积
console.log(agent.getMessages().length)    // 4（2 user + 2 assistant）
```

**v0.1 完成标志：5 行代码能让 agent 流式输出，多轮 messages 自动累积。**

---

## v0.2 — 消息转换层

### v0.2.1 — convertToLlm

**目标：业务层可以过滤/转换消息，LLM 只收到它能理解的格式。**

做什么：

- `agentLoop` 的 `config` 已有 `convertToLlm` 参数（v0.1.2 定义），这里实现调用时机
- 每次 LLM 调用前，先执行 `convertToLlm(context.messages)`，再传给 `ModelAdapter.stream()`
- 默认行为：`(msgs) => msgs.filter(m => ["user","assistant","toolResult","system"].includes(m.role))`

验证：

```ts
// playground/cases/convert.ts
const agent = new Agent({
  model: adapter,
  convertToLlm: (msgs) => {
    // 只传 user 和 assistant，过滤掉其他类型
    const filtered = msgs.filter(m => ["user", "assistant"].includes(m.role))
    console.log("发给 LLM 的消息数:", filtered.length)
    return filtered
  },
})
await agent.prompt("你好")
```

---

### v0.2.2 — transformContext

**目标：每次 LLM 调用前可以剪枝/压缩 messages，处理 long session。**

做什么：

- `agentLoop` 在 `convertToLlm` 之前执行 `transformContext`
- 执行顺序：`messages → transformContext() → convertToLlm() → LLM`
- 如果 messages 数量变少，emit `context_compacted` 事件

```ts
// 执行时机
const transformed = config.transformContext
  ? await config.transformContext(context.messages, signal)
  : context.messages

const llmMessages = config.convertToLlm
  ? config.convertToLlm(transformed)
  : transformed

yield* model.stream(llmMessages, { tools, signal })
```

验证：

```ts
// playground/cases/compaction-basic.ts
let compacted = false
const agent = new Agent({
  model: adapter,
  transformContext: async (msgs) => {
    if (msgs.length > 5) {
      compacted = true
      return msgs.slice(-4)    // 只保留最近 4 条
    }
    return msgs
  },
})

agent.subscribe(e => { if (e.type === "context_compacted") console.log("已压缩", e) })

// 发送 6 轮，第 6 轮触发 compaction
for (let i = 0; i < 6; i++) await agent.prompt(`第${i+1}轮`)
console.log(compacted)  // true
```

---

### v0.2.3 — 完整 AgentEvent 类型 + 事件序列验证

**目标：确认所有事件在正确时机 emit，顺序符合预期。**

做什么：

- 给每个事件加 `seq`（自增）便于 replay 排序
- playground 写完整的事件序列断言

验证：

```ts
// playground/cases/event-sequence.ts
const log: Array<{ seq: number; type: string }> = []
let seq = 0
agent.subscribe(e => log.push({ seq: seq++, type: e.type }))

await agent.prompt("你好")

const types = log.map(e => e.type)
console.assert(types[0] === "agent_start")
console.assert(types[types.length - 1] === "agent_end")
console.assert(types.includes("turn_start"))
console.assert(types.includes("message_update"))
console.log("✅ 事件序列正确")
```

**v0.2 完成标志：消息转换层完整，长对话可截断，事件序列可验证。**

---

## v0.3 — Tool Calling

### v0.3.1 — ToolDef + ToolRegistry

```ts
export class ToolRegistry {
  register(tool: ToolDef): void
  get(name: string): ToolDef | undefined
  list(): ToolDef[]
}
```

验证：工具能注册和查找。

---

### v0.3.2 — ToolExecutor

```ts
export class ToolExecutor {
  async execute(
    call: { toolCallId: string; name: string; args: unknown },
    registry: ToolRegistry,
    signal?: AbortSignal
  ): Promise<ToolResult>
}
```

规则：tool 报错返回 `isError: true`，不 throw；工具不存在返回 error result。

验证：

```ts
const result = await executor.execute({ toolCallId: "1", name: "crash", args: {} }, registry)
console.assert(result.isError === true)   // 不 crash
```

---

### v0.3.3 — agentLoop 多轮 + tool 事件

**目标：loop 能处理 tool_call chunk，完整多轮对话。**

做什么：

- `ModelAdapter.stream()` yield `tool_call` chunk 时，进入 tool 执行分支
- emit `tool_execution_start` → execute → emit `tool_execution_end`
- tool result 追加 messages，继续下一轮 LLM 调用
- `Agent` 类把 tools 传给 `agentLoop`

验证：

```ts
// playground/cases/tool-call.ts
const agent = new Agent({
  model: adapter,
  tools: [{
    name: "get_time",
    description: "获取当前时间",
    parameters: {},
    execute: async () => ({ time: new Date().toISOString() }),
  }],
})

const eventTypes: string[] = []
agent.subscribe(e => eventTypes.push(e.type))
await agent.prompt("现在几点了")

console.assert(eventTypes.includes("tool_execution_start"))
console.assert(eventTypes.includes("tool_execution_end"))
```

**v0.3 完成标志：tool 被 LLM 调用，错误不 crash，事件完整，多轮 loop 正确结束。**

---

## v0.4 — Loop 控制

### v0.4.1 — AbortSignal

**目标：用户可以随时取消 loop。**

做什么：

- `agentLoop` 的 `signal` 透传给 `ModelAdapter.stream()`、`ToolExecutor.execute()`、`transformContext()`
- abort 后立即退出，emit `agent_end`
- `Agent.abort()` 内部调用 `controller.abort()`

验证：

```ts
// playground/cases/abort.ts
const agent = new Agent({ model: adapter })
agent.subscribe(e => { if (e.type === "agent_end") console.log("结束") })

setTimeout(() => agent.abort(), 500)   // 500ms 后取消
await agent.prompt("写一篇 10000 字的文章")
// 期望：500ms 后输出"结束"，不等 LLM 回复完
```

---

### v0.4.2 — beforeToolCall + afterToolCall

做什么：

```ts
// beforeToolCall 在 tool_execution_start 后、实际执行前调用
// 返回 "block" 则跳过执行，向 LLM 返回 blocked error result
beforeToolCall?: async ({ name, args, context }) => "allow" | "block"

// afterToolCall 在 tool_execution_end emit 前调用
afterToolCall?: async ({ name, result, isError, context }) => void
```

验证：

```ts
// playground/cases/hooks.ts
const blocked: string[] = []
const agent = new Agent({
  model: adapter,
  tools: [dangerousTool],
  beforeToolCall: async ({ name }) => {
    if (name === "dangerous") { blocked.push(name); return "block" }
    return "allow"
  },
})
await agent.prompt("执行危险操作")
console.assert(blocked.includes("dangerous"))
```

---

### v0.4.3 — shouldStopAfterTurn + terminate

做什么：

- `shouldStopAfterTurn` 在 `turn_end` 之后调用，返回 `true` 则 emit `agent_end` 退出
- tool `execute` 可返回 `{ terminate: true }`，所有 tool 都返回 terminate 时 loop 自动停止

验证：

```ts
let turns = 0
const agent = new Agent({
  model: adapter,
  shouldStopAfterTurn: () => { turns++; return turns >= 2 },
})
await agent.prompt("不停工作")
console.assert(turns === 2)
```

**v0.4 完成标志：业务 agent 可以完整控制 loop 生命周期，取消随时可用。**

---

## v0.5 — 并行 Tool 执行

### v0.5.1 — parallel 模式

**目标：同一轮多个 tool call 并发执行，减少等待时间。**

做什么：

- `AgentLoopConfig` 新增 `toolExecution: "parallel" | "sequential"`（默认 `"parallel"`）
- 多个 tool_call 用 `Promise.all` 并发，`tool_execution_end` 按完成顺序 emit
- toolResult messages 按 LLM 原始顺序追加（不按完成顺序）

验证：

```ts
// 两个各需 500ms 的 tool，parallel 总耗时应接近 500ms，不是 1000ms
const start = Date.now()
await agent.prompt("同时查询 A 和 B")
console.assert(Date.now() - start < 800)
```

---

### v0.5.2 — per-tool executionMode

**目标：单个 tool 可声明必须串行。**

做什么：一批 tool call 中有任何一个 `executionMode: "sequential"`，整批退化为串行。

验证：混入 sequential tool 后，整批耗时变为两个 tool 之和。

**v0.5 完成标志：并发 tool 正常工作，消息顺序保持正确。**

---

## v0.6 — Sub-agent（Multi-agent）

### v0.6.1 — createSubagentTool

**目标：Agent 可以作为 Tool 被其他 Agent 调用，实现 multi-agent。**

做什么：

```ts
// runtime/tool/subagent.ts
export function createSubagentTool(opts: {
  name: string
  description: string
  agent: Agent
  parameters?: Record<string, unknown>
}): ToolDef
```

内部：`execute` 调用 `subAgent.prompt(args.task)`，等待完成，返回最终 messages 摘要。

```ts
// 使用示例
const reviewAgent = new Agent({ model, systemPrompt: "You are a code reviewer." })

const parentAgent = new Agent({
  model,
  tools: [
    createSubagentTool({
      name: "code_review",
      description: "委托代码审查专家",
      agent: reviewAgent,
    }),
  ],
})

await parentAgent.prompt("审查代码质量")
```

验证：

```ts
// playground/cases/subagent.ts
// 验证父 agent 能正确调用子 agent，子 agent 结果返回给父 agent
```

---

### v0.6.2 — 子 agent 事件透传

**目标：消费方可以观察到子 agent 的执行事件。**

做什么：

- 子 agent 执行时，其事件通过父 agent 的 `tool_execution_update` 透传
- 事件携带 `source: "subagent"` 和 `agentName` 字段

```ts
parentAgent.subscribe((event) => {
  if (event.type === "tool_execution_update" && event.source === "subagent") {
    console.log(`子 agent [${event.agentName}]:`, event.partial)
  }
})
```

验证：父 agent subscribe 能收到子 agent 的 message_update 事件。

**v0.6 完成标志：multi-agent 通过 tool 机制实现，无需额外 orchestration。**

---

## v0.7 — Context Compaction（完整实现）

### v0.7.1 — Token 估算工具

**目标：能估算当前 context 的 token 数，作为 compaction 触发条件。**

做什么：

```ts
// runtime/context/tokens.ts
export function estimateTokens(messages: AgentMessage[]): number
// 基于字符数的简单估算，不依赖 tokenizer
// 精确估算由使用者在 transformContext 中自行实现
```

验证：

```ts
const count = estimateTokens([{ role: "user", content: "hello world", timestamp: 0 }])
console.assert(count > 0)
```

---

### v0.7.2 — Compaction 触发时机 + 事件

**目标：`transformContext` 执行后，如果 messages 减少则 emit `context_compacted`。**

做什么：

- 在 `agentLoop` 内部，每轮 LLM 调用前执行 `transformContext`
- 对比执行前后的 token 估算，如有减少则 emit `context_compacted { tokensBefore, tokensAfter }`
- 提供 `onContextNearLimit` 回调（可选），在接近 limit 时主动触发

验证：

```ts
agent.subscribe(e => {
  if (e.type === "context_compacted") {
    console.log(`压缩：${e.tokensBefore} → ${e.tokensAfter} tokens`)
  }
})
```

---

### v0.7.3 — LLM 摘要压缩示例

**目标：在 examples/ 中提供完整的 LLM 摘要压缩实现，供使用者参考。**

做什么：在 `examples/compaction/` 中提供：

```ts
// examples/compaction/llm-summarize.ts
import { estimateTokens } from "@helix/runtime"

const TOKEN_LIMIT = 80_000

async function summarizeCompaction(
  messages: AgentMessage[],
  summaryModel: ModelAdapter,
  signal?: AbortSignal
): Promise<AgentMessage[]> {
  if (estimateTokens(messages) < TOKEN_LIMIT) return messages

  const toSummarize = messages.slice(0, -10)
  const recent = messages.slice(-10)

  // 用 LLM 生成摘要
  const summary = await collectText(
    summaryModel.stream([
      { role: "user", content: `请总结以下对话：\n${serializeMessages(toSummarize)}`, timestamp: Date.now() }
    ], { signal })
  )

  return [
    { role: "system", content: `历史对话摘要：${summary}`, timestamp: Date.now() },
    ...recent,
  ]
}

// 使用方式
const agent = new Agent({
  model,
  transformContext: (msgs, signal) => summarizeCompaction(msgs, summaryModel, signal),
})
```

**v0.7 完成标志：long session 有完整解决方案，runtime 不内置策略，使用者自由选择。**

---

## v1.0 — 稳定发布

### v1.0.1 — API Review

- 审查所有对外 export，去掉内部实现
- 冻结 API，不再破坏性变更
- 补全所有 public API 的 JSDoc

### v1.0.2 — Docs + Examples

```
docs/
  quick-start.md      ← 5 分钟跑通第一个 agent
  tools.md            ← 如何定义和注册 tool
  events.md           ← 事件类型和消费方式
  multi-agent.md      ← createSubagentTool 完整示例
  compaction.md       ← long session 处理策略

examples/
  basic-agent/        ← 最简 agent
  tool-agent/         ← 带 tool 的 agent
  multi-agent/        ← 父子 agent
  compaction/         ← LLM 摘要压缩
  custom-model/       ← 接入自定义 LLM
```

### v1.0.3 — CI/CD + npm 发布

- GitHub Actions：push 触发 build + typecheck
- tag 触发自动发布
- 发布顺序：`core` → `models` + `runtime`

**v1.0 完成标志：文档齐全，外部 agent 工程 `npm install @helix/runtime` 即可上手。**

---

## 后续（v1.x，按需）

| 版本 | 内容                                     | 触发条件                         |
| ---- | ---------------------------------------- | -------------------------------- |
| v1.1 | Session 持久化（SessionStore interface） | 有跨进程多轮对话需求             |
| v1.2 | `@helix/tools` 独立包                    | 内置 tool 数量 > 10              |
| v1.3 | Replay（基于事件流重建 session）         | 有 Debugger / Observability 需求 |
| v1.4 | AnthropicAdapter 完整实现                | 有 Anthropic 模型使用需求        |
| v2.0 | 更复杂的 multi-agent 模式                | 出现真实 orchestration 需求      |