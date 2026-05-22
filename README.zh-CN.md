# Helix Runtime

一个 TypeScript Native、Runtime First 的 Agent Harness 基础设施项目。

## 项目定位

Helix Runtime 并不是传统意义上的 Agent Framework。

它关注的是：

# Agent Harness Runtime

也就是：

Agent 在真实运行过程中所依赖的底层 Runtime Harness 系统。

包括：

- execution runtime
- structured session state
- event-driven architecture
- streaming lifecycle
- environment isolation
- runtime orchestration

## 设计哲学

Helix Runtime 严格遵循：

# Runtime First

即：

所有抽象都必须来自真实运行中的重复问题。

而不是提前设计：

- workflow
- planner
- graph runtime
- multi-agent system

项目强调：

- small core
- progressive evolution
- execution-centric architecture
- structured runtime state

## 愿景

现代 Agent 的核心并不只是 Model。

真正决定 Agent 能力的，是：

- Runtime
- Harness
- Execution System
- Tool Runtime
- Session State
- Event Lifecycle

Helix Runtime 的目标是构建：

> 一个可持续演化的 Agent Harness Runtime。

## 当前阶段

当前阶段聚焦：

- runtime kernel
- execution loop
- event system
- execution context
- session runtime

避免过早进入：

- orchestration platform
- distributed scheduling
- cloud runtime
- workflow engine

## Monorepo Structure

```text
packages/
  core/
  runtime/
```

## License

MIT