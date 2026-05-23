import type { AgentContext, AgentMessage, ModelAdapter, ToolDef, ToolResult } from "@helix/core";
import type { AgentEvent } from "../event";
import type { AgentLoopConfig } from "../loop";
import { agentLoop, agentLoopContinue } from "../loop";


export interface AgentOptions extends Omit<AgentLoopConfig, "model" | "signal"> {
  model: ModelAdapter;
  systemPrompt?: string;
  tools?: ToolDef<any>[];
}

/**
 * Stateful wrapper around agentLoop.
 *
 * Manages the AgentContext (messages accumulation) so callers don't have to.
 * All events are observable via subscribe().
 *
 * @example
 * const agent = new Agent({ model, systemPrompt: "You are helpful.", tools: [myTool] })
 *
 * agent.subscribe(e => {
 *   if (e.type === "message_update") process.stdout.write(e.delta)
 * })
 *
 * await agent.prompt("Hello!")
 * await agent.prompt("What did I just say?")  // messages auto-accumulated
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


  /**
   * Send a user message and run the agent loop.
   * New messages are automatically appended to context.messages.
   */
  async prompt(input: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const userMsg: AgentMessage = {
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    const newMessages = await agentLoop(
      [userMsg],
      this.context,
      { ...this.loopConfig, signal },
      (e) => this.handlers.forEach((h) => h(e))
    );

    // Accumulate: add user message + all new messages from the loop
    this.context.messages.push(userMsg, ...newMessages);
    this.abortController = null;
  }

  /**
   * Continue the loop from the current context (no new user message).
   * Useful for retrying after an error.
   */
  async continue(opts?: { signal?: AbortSignal }): Promise<void> {
    this.abortController = new AbortController();
    const signal = opts?.signal ?? this.abortController.signal;

    const newMessages = await agentLoopContinue(
      this.context,
      { ...this.loopConfig, signal },
      (e) => this.handlers.forEach((h) => h(e))
    );

    this.context.messages.push(...newMessages);
    this.abortController = null;
  }

  /**
   * Abort the currently running loop.
   * Emits agent_end and resolves the pending prompt() call.
   */
  abort(): void {
    this.abortController?.abort();
  }

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
