import type { AgentContext, AgentMessage, ModelAdapter, ToolDef, ToolResult } from "@helix/core";
import type { AgentEvent } from "../event";
import type { AgentLoopConfig } from "../loop";
import { agentLoop, agentLoopContinue } from "../loop";

// ─── AgentOptions ─────────────────────────────────────────────────────────────

export interface AgentOptions extends Omit<AgentLoopConfig, "model" | "signal"> {
  model: ModelAdapter;
  systemPrompt?: string;
  tools?: ToolDef[];
}

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Stateful wrapper around agentLoop.
 *
 * Manages the AgentContext (message accumulation) so callers don't have to.
 * All events are observable via subscribe().
 *
 * @example
 * const agent = new Agent({
 *   model: getModel({ model: "gpt-4o", apiKey: "..." }),
 *   systemPrompt: "You are helpful.",
 *   tools: [myTool],
 * })
 *
 * agent.subscribe(e => {
 *   if (e.type === "message_update") process.stdout.write(e.delta)
 * })
 *
 * await agent.prompt("Hello!")
 * await agent.prompt("What did I say?")  // messages auto-accumulated
 */
export class Agent {
  private context: AgentContext;
  private handlers: Array<(e: AgentEvent) => void> = [];
  private abortController: AbortController | null = null;
  private readonly loopConfig: Omit<AgentLoopConfig, "signal">;

  constructor(private readonly opts: AgentOptions) {
    this.context = {
      systemPrompt: opts.systemPrompt ?? "",
      messages: [],
      tools: opts.tools ?? [],
    };

    this.loopConfig = {
      model: opts.model,
      transformContext: opts.transformContext,
      convertToLlm: opts.convertToLlm,
      beforeToolCall: opts.beforeToolCall,
      afterToolCall: opts.afterToolCall,
      shouldStopAfterTurn: opts.shouldStopAfterTurn,
    };
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to all agent events.
   * Returns an unsubscribe function — call it to stop receiving events.
   */
  subscribe(handler: (e: AgentEvent) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  // ── Core API ─────────────────────────────────────────────────────────────────

  /**
   * Send a user message and run the agent loop.
   * The user message and all produced messages are accumulated into context.
   */
  async prompt(input: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const userMsg: AgentMessage = {
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    try {
      const newMessages = await agentLoop(
        [userMsg],
        this.context,
        { ...this.loopConfig, signal },
        (e) => this.handlers.forEach((h) => h(e))
      );
      this.context.messages.push(userMsg, ...newMessages);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Continue the loop from the current context without a new user message.
   * Useful for retrying after an error or resuming an interrupted run.
   */
  async continue(opts?: { signal?: AbortSignal }): Promise<void> {
    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    try {
      const newMessages = await agentLoopContinue(
        this.context,
        { ...this.loopConfig, signal },
        (e) => this.handlers.forEach((h) => h(e))
      );
      this.context.messages.push(...newMessages);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Abort the currently running loop.
   * The pending prompt() / continue() call will resolve (not throw).
   */
  abort(): void {
    this.abortController?.abort();
  }

  // ── Context Access ────────────────────────────────────────────────────────────

  /** Returns a shallow copy of the accumulated messages. */
  getMessages(): AgentMessage[] {
    return [...this.context.messages];
  }

  /** Clears the message history (keeps systemPrompt and tools). */
  clearMessages(): void {
    this.context.messages = [];
  }

  /** Returns a readonly view of the current context. */
  getContext(): Readonly<AgentContext> {
    return this.context;
  }
}
