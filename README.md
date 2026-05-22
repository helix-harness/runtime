# Helix Runtime

TypeScript-native runtime-first agent harness infrastructure.

## Philosophy

Helix Runtime is not a traditional agent framework.

It focuses on building the runtime harness layer behind autonomous agents:

- execution runtime
- structured session state
- event-driven architecture
- streaming lifecycle
- environment isolation
- progressive runtime evolution

The project follows a strict runtime-first philosophy:

> Every abstraction must emerge from real execution problems.

## Vision

Modern agents are not just prompts.

They are long-running execution systems powered by:

- runtime loops
- execution contexts
- tool systems
- event propagation
- structured state
- runtime orchestration

Helix Runtime aims to provide the foundational harness runtime for these systems.

## Current Status

Early runtime kernel development.

Current focus:

- runtime loop
- execution context
- session model
- event system
- streaming lifecycle

Avoiding premature abstractions such as:

- workflow orchestration
- multi-agent systems
- planner architectures
- graph runtimes

## Monorepo Structure

```text
packages/
  core/
  runtime/
```

## Development

```bash
pnpm install
pnpm build
```

## License

MIT