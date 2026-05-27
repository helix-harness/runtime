import type { AgentContext, AgentMessage, ModelAdapter, ToolDef } from "@helix/core";
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
 * Manages AgentContext (message accumulation) so callers don't have to.
 * Consumes the AsyncGenerator internally; exposes subscribe() for events.
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
   * Returns an unsubscribe function.
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
      const stream = agentLoop(
        [userMsg],
        this.context,
        { ...this.loopConfig, signal }
      );

      for await (const event of stream) {
        // Dispatch to subscribers
        this.handlers.forEach((h) => h(event));

        // Accumulate messages on agent_end
        if (event.type === "agent_end") {
          this.context.messages.push(userMsg, ...event.messages);
        }
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Continue the loop from the current context without a new user message.
   * Useful for retrying after an error or resuming an interrupted run.
   *
   * Precondition: the last message in context must be "user" or "toolResult".
   * Calling continue() when the last message is "assistant" is a logic error —
   * the LLM would see an assistant message with no follow-up, which produces
   * unpredictable results.
   *
   * @throws Error if context is empty or last message role is "assistant"
   */
  async continue(opts?: { signal?: AbortSignal }): Promise<void> {
    // ── Bug 3 fix: validate context before continuing ──────────────────────
    const messages = this.context.messages;
    if (messages.length === 0) {
      throw new Error(
        "[helix/runtime] Agent.continue() called with empty message history. " +
        "Use agent.prompt() to start a conversation."
      );
    }
    const lastRole = messages[messages.length - 1]!.role;
    if (lastRole === "assistant") {
      throw new Error(
        "[helix/runtime] Agent.continue() called after an assistant message. " +
        "The last message must be 'user' or 'toolResult'. " +
        "Use agent.prompt() to send a new user message instead."
      );
    }

    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    try {
      const stream = agentLoopContinue(
        this.context,
        { ...this.loopConfig, signal }
      );

      for await (const event of stream) {
        this.handlers.forEach((h) => h(event));

        if (event.type === "agent_end") {
          this.context.messages.push(...event.messages);
        }
      }
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
