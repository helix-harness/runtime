import type { AgentContext, AgentMessage, ModelAdapter, ToolDef, ContentPart } from "@helix/core";
import type { AgentEvent } from "../event/types";
import type { AgentLoopConfig, StreamFn } from "../loop/index";
import { agentLoop, agentLoopContinue } from "../loop/index";

// ─── SteeringMode ─────────────────────────────────────────────────────────────

/**
 * Controls how the Agent handles concurrent prompt() calls.
 *
 * - "one-at-a-time" (default): Each prompt() queues behind the current one.
 *   Calls are executed sequentially in arrival order.
 *   Safe for multi-user or rapid-fire prompt scenarios.
 *
 * - "all": All prompt() calls run concurrently against the same context.
 *   WARNING: concurrent writes to context.messages are NOT safe.
 *   Only use when you manage context isolation yourself.
 */
export type SteeringMode = "one-at-a-time" | "all";

// ─── AgentOptions ─────────────────────────────────────────────────────────────

export interface AgentOptions extends Omit<AgentLoopConfig, "model" | "signal"> {
  model: ModelAdapter;
  systemPrompt?: string;
  tools?: ToolDef[];
  /**
   * How to handle concurrent prompt() calls.
   * @default "one-at-a-time"
   */
  steeringMode?: SteeringMode;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Stateful wrapper around agentLoop.
 *
 * Key features:
 * - Accumulates messages automatically across prompt() calls
 * - subscribe() for real-time event observation
 * - steeringMode: serialize or allow concurrent prompts
 * - waitForIdle(): wait for all async subscribers to complete
 * - abort(): cancel the current loop
 *
 * @example
 * const agent = new Agent({
 *   model: getModel({ model: "gpt-4o", apiKey: "..." }),
 *   systemPrompt: "You are helpful.",
 *   tools: [myTool],
 *   steeringMode: "one-at-a-time",
 * })
 *
 * agent.subscribe(e => {
 *   if (e.type === "message_update") process.stdout.write(e.delta)
 * })
 *
 * await agent.prompt("Hello!")
 * await agent.waitForIdle()
 */
export class Agent {
  private context: AgentContext;
  private handlers: Array<(e: AgentEvent) => void | Promise<void>> = [];
  private abortController: AbortController | null = null;
  private readonly loopConfig: Omit<AgentLoopConfig, "signal">;
  private readonly steeringMode: SteeringMode;

  // ── steeringMode: one-at-a-time queue ────────────────────────────────────
  private promptQueue: Promise<void> = Promise.resolve();

  // ── waitForIdle: track in-flight subscriber promises ─────────────────────
  private idlePromises: Set<Promise<void>> = new Set();

  constructor(private readonly opts: AgentOptions) {
    this.context = {
      systemPrompt: opts.systemPrompt ?? "",
      messages: [],
      tools: opts.tools ?? [],
    };

    this.steeringMode = opts.steeringMode ?? "one-at-a-time";

    this.loopConfig = {
      model: opts.model,
      streamFn: opts.streamFn,
      thinkingLevel: opts.thinkingLevel,
      transformContext: opts.transformContext,
      convertToLlm: opts.convertToLlm,
      beforeToolCall: opts.beforeToolCall,
      afterToolCall: opts.afterToolCall,
      shouldStopAfterTurn: opts.shouldStopAfterTurn,
    };
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  /**
   * Subscribe to all agent events.
   * The handler may be async — waitForIdle() will wait for it to settle.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (e: AgentEvent) => void | Promise<void>): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Send a user message and run the agent loop.
   *
   * With steeringMode "one-at-a-time" (default):
   *   Queues behind any currently running prompt. Safe for concurrent callers.
   *
   * With steeringMode "all":
   *   Runs immediately regardless of other in-flight prompts.
   */
  async prompt(input: string | ContentPart[], opts?: { signal?: AbortSignal }): Promise<void> {
    if (this.steeringMode === "one-at-a-time") {
      // Chain onto the queue — each prompt waits for the previous one
      this.promptQueue = this.promptQueue.then(() =>
        this._runPrompt(input, opts)
      );
      return this.promptQueue;
    }
    return this._runPrompt(input, opts);
  }

  private async _runPrompt(
    input: string | ContentPart[],
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    const userMsg: AgentMessage = {
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    try {
      const stream = agentLoop(
        [userMsg],
        this.context,
        { ...this.loopConfig, signal }
      );

      for await (const event of stream) {
        this._dispatch(event);
        if (event.type === "agent_end") {
          this.context.messages.push(userMsg, ...event.messages);
        }
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Continue the loop without a new user message.
   * Last context message must be "user" or "toolResult".
   *
   * BUG FIX #3: validates context before running.
   */
  async continue(opts?: { signal?: AbortSignal }): Promise<void> {
    const messages = this.context.messages;
    if (messages.length > 0) {
      const lastRole = messages[messages.length - 1]!.role;
      if (lastRole === "assistant") {
        throw new Error(
          "[helix/runtime] Agent.continue() called with an assistant message as the " +
          "last message in context. continue() resumes after a user message or tool result. " +
          "Did you mean to call agent.prompt() instead?"
        );
      }
    }

    const run = async () => {
      this.abortController = new AbortController();
      const signal = opts?.signal ?? this.abortController.signal;

      try {
        const stream = agentLoopContinue(
          this.context,
          { ...this.loopConfig, signal }
        );

        for await (const event of stream) {
          this._dispatch(event);
          if (event.type === "agent_end") {
            this.context.messages.push(...event.messages);
          }
        }
      } finally {
        this.abortController = null;
      }
    };

    if (this.steeringMode === "one-at-a-time") {
      this.promptQueue = this.promptQueue.then(() => run());
      return this.promptQueue;
    }
    return run();
  }

  /**
   * Abort the currently running loop.
   * The pending prompt() / continue() call will resolve (not throw).
   */
  abort(): void {
    this.abortController?.abort();
  }

  // ── waitForIdle ───────────────────────────────────────────────────────────

  /**
   * Wait until:
   *   1. All queued prompt() calls have completed (steeringMode: one-at-a-time)
   *   2. All async event handlers have settled
   *
   * Use this when your subscribers do async work (e.g. writing to a database)
   * and you need to ensure everything has finished before proceeding.
   *
   * @example
   * agent.subscribe(async (e) => {
   *   if (e.type === "agent_end") await db.saveSession(agent.getMessages())
   * })
   *
   * await agent.prompt("Hello")
   * await agent.waitForIdle()
   * // db.saveSession has now completed
   */
  async waitForIdle(): Promise<void> {
    // Wait for the prompt queue to drain
    await this.promptQueue;

    // Wait for all in-flight subscriber promises
    if (this.idlePromises.size > 0) {
      await Promise.allSettled([...this.idlePromises]);
    }
  }

  // ── Internal dispatch ─────────────────────────────────────────────────────

  private _dispatch(event: AgentEvent): void {
    for (const handler of this.handlers) {
      const result = handler(event);
      if (result instanceof Promise) {
        // Track async handlers for waitForIdle()
        this.idlePromises.add(result);
        result.finally(() => this.idlePromises.delete(result));
      }
    }
  }

  // ── Context Access ────────────────────────────────────────────────────────

  getMessages(): AgentMessage[] {
    return [...this.context.messages];
  }

  clearMessages(): void {
    this.context.messages = [];
  }

  getContext(): Readonly<AgentContext> {
    return this.context;
  }
}
