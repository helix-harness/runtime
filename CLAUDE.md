# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目定位

@helix/runtime 是一个 **Harness Runtime SDK**，用于构建 AI Agent。

**不是 AI，不是 Agent 产品，是让任何人都能快速构建 Agent 的执行层基础设施。**

核心公式：**Agent = Model + Harness**

| 层 | 职责 | 谁来做 |
|---|---|---|
| Model（思考层） | 推理、生成、tool call decision | GPT / Claude / Gemini |
| Harness（执行层） | loop 控制、tool 执行、状态管理、事件流 | **@helix/runtime** |

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm build         # 构建所有包
pnpm dev           # 所有包运行 dev 模式
pnpm test          # 运行测试
pnpm typecheck     # 类型检查
pnpm lint          # 代码检查
```

**单独操作某个包：**
```bash
cd packages/core && pnpm build
cd packages/runtime && pnpm dev
```

## 架构

### 包结构

```
packages/
├── core/         # @helix/core — 零依赖共享类型
│                 #   类型：AgentMessage, AgentContext, ToolDef, AgentEvent, ModelAdapter
├── runtime/      # @helix/runtime — Harness 核心（agentLoop、Agent 类、tool 执行）
├── events/       # @helix/events — 事件总线系统
├── models/       # @helix/models — LLM 适配器（OpenAI、Anthropic 等）
├── shared/       # @helix/shared — 共享工具
└── tools/        # @helix/tools — 内置工具生态（未来）

apps/
└── playground/   # 开发测试场
```

### 依赖层次

```
@helix/core        ← 零依赖
      ↑         ↑
@helix/runtime  @helix/models   ← 互不依赖，各自依赖 core
      ↑
业务 agent 工程    ← 消费 SDK，独立 repo
```

### 核心概念

#### 1. Agent Loop = 事件驱动

所有 runtime 行为必须可事件化。`agentLoop()` 返回 `AsyncIterable<AgentEvent>`：

```
agent_start
  turn_start
    message_start/message_end (user)
    message_start
      message_update (streaming delta)
    message_end (assistant)
    tool_execution_start → tool_execution_end (如有 tool call)
  turn_end
agent_end
```

#### 2. 两种使用方式

**方式 A：Agent 类（推荐，有状态封装）**
```ts
const agent = new Agent({
  model: getModel("openai", "gpt-4o"),
  systemPrompt: "You are helpful.",
  tools: [myTool],
  convertToLlm: (msgs) => msgs.filter(...),
  transformContext: async (msgs) => msgs.slice(-50),
})

agent.subscribe(handler)
await agent.prompt("任务")
await agent.continue()
agent.abort()
```

**方式 B：agentLoop 函数（低层，无状态）**
```ts
const stream = agentLoop(prompts, context, { model, signal })
for await (const event of stream) { ... }
```

#### 3. 消息转换管道

```
AgentMessage[] → transformContext() → convertToLlm() → LLM Message[]
```

- `transformContext`：可选，用于长对话的剪枝/压缩
- `convertToLlm`：必须，过滤 UI-only 消息，转换自定义类型，LLM 只理解标准角色

#### 4. Tool 系统

- Tool 通过 `ToolRegistry` 注册
- 执行模式：`parallel`（默认）或 `sequential`
- `createSubagentTool()` 将 Agent 作为 Tool 包装，实现 multi-agent

### Harness Runtime 负责

- Agent loop 控制（多轮对话、tool call 处理）
- Tool orchestration（注册、执行、并行/串行、错误处理）
- 消息转换（AgentMessage → LLM Message）
- Context 管理（剪枝、压缩）
- Event streaming（所有行为事件化）
- Loop 控制钩子（beforeToolCall、afterToolCall、shouldStopAfterTurn）
- 取消控制（AbortSignal）

### Harness Runtime 不负责

- ❌ 业务逻辑
- ❌ Prompt engineering
- ❌ Agent 产品设计
- ❌ 持久化存储

## 设计原则

| 原则 | 内容 |
|------|------|
| Agent First | `Agent = Model + Harness`，AI 能力和执行控制分离 |
| Runtime First | 所有 agent 行为必须经过 runtime |
| Event First | 所有 runtime 行为必须可事件化，agentLoop 返回 AsyncIterable |
| Stateless Loop | `agentLoop` 是纯函数，Agent 类在上层做有状态封装 |
| No Premature Abstraction | 未出现真实需求前不引入复杂机制 |

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

## 关键文件

| 文件 | 用途 |
|------|------|
| `packages/core/src/message.ts` | AgentMessage 类型（角色：user/assistant/toolResult/system/custom） |
| `packages/core/src/runtime.ts` | AgentContext 类型 |
| `packages/core/src/tool.ts` | ToolDef, ToolResult 类型 |
| `packages/runtime/src/runtime.ts` | 核心运行时循环实现 |
| `packages/events/src/event.ts` | AgentEvent 类型定义 |
| `turbo.json` | 构建编排（build 输出：`dist/**`） |

## 技术栈

- **Runtime**: TypeScript 6, ESNext modules
- **构建**: tsup（ESM 输出 + DTS）
- **编排**: Turbo（pnpm workspace）
- **包管理**: pnpm 10.33.2