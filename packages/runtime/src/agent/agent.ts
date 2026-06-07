import type { AgentContext, AgentMessage, ModelAdapter, ToolDef, ContentPart, Skill } from "@helixharness/core";
import type { SkillDiagnostic } from "../skill/loader";
import type { AgentEvent } from "../event/types";
import type { AgentLoopConfig, StreamFn } from "../loop/index";
import { agentLoop, agentLoopContinue } from "../loop/index";
import { SkillRegistry } from "../skill/SkillRegistry";
import { formatSkillsForPrompt } from "../skill/prompt";
import { createLoadSkillTool } from "../skill/load-skill-tool";

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
  /** Skills available for progressive disclosure and programmatic invocation. */
  skills?: Skill[];
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
 * - Skills: progressive disclosure via system prompt, programmatic invocation via invokeSkill()
 *
 * @example
 * const agent = new Agent({
 *   model: getModel({ model: "gpt-4o", apiKey: "..." }),
 *   systemPrompt: "You are helpful.",
 *   tools: [myTool],
 *   skills: [codeReviewSkill],
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

  // ── Tools: two-tier management (registered vs active) ──────────────────────
  private readonly registeredTools = new Map<string, ToolDef>();
  /** System-managed tools (e.g. load_skill) — always active, never in registeredTools. */
  private readonly systemTools: ToolDef[] = [];

  // ── Skills ────────────────────────────────────────────────────────────────────
  private readonly skillRegistry: SkillRegistry;
  private readonly baseSystemPrompt: string;

  // ── steeringMode: one-at-a-time queue ────────────────────────────────────
  private promptQueue: Promise<void> = Promise.resolve();

  // ── waitForIdle: track in-flight subscriber promises ─────────────────────
  private idlePromises: Set<Promise<void>> = new Set();

  constructor(private readonly opts: AgentOptions) {
    this.steeringMode = opts.steeringMode ?? "one-at-a-time";

    // ── Initialize skills ─────────────────────────────────────────────────────
    this.skillRegistry = new SkillRegistry();
    if (opts.skills) {
      for (const d of this.skillRegistry.registerAll(opts.skills)) {
        console.warn(`[helix/runtime] Agent: skill "${d.path}" — ${d.message}`);
      }
    }

    // ── Build system prompt ───────────────────────────────────────────────────
    this.baseSystemPrompt = opts.systemPrompt ?? "";
    const skills = this.skillRegistry.list();

    // ── Build tools (two-tier: registered vs active) ─────────────────────────
    for (const t of opts.tools ?? []) {
      if (this.registeredTools.has(t.name)) {
        console.warn(`[helix/runtime] Agent: duplicate tool "${t.name}" — later wins`);
      }
      this.registeredTools.set(t.name, t);
    }
    const tools = [...this.registeredTools.values()];
    if (skills.length > 0) {
      const loadSkill = createLoadSkillTool(this.skillRegistry);
      this.systemTools.push(loadSkill);
      tools.push(loadSkill);
    }

    // ── Build context ─────────────────────────────────────────────────────────
    this.context = {
      systemPrompt: this.baseSystemPrompt + formatSkillsForPrompt(skills),
      messages: [],
      tools,
    };

    // ── Build loop config (immutable after construction) ──────────────────────
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

  // ── Skill API ─────────────────────────────────────────────────────────────

  /**
   * Register a skill at runtime (supports in-memory skills without filePath).
   * Returns diagnostics for any validation issues.
   * Automatically updates system prompt and injects load_skill tool if needed.
   */
  registerSkill(skill: Skill): SkillDiagnostic[] {
    const diagnostics = this.skillRegistry.register(skill);

    // Rebuild system prompt with updated skill list
    this.context.systemPrompt = this.baseSystemPrompt + formatSkillsForPrompt(this.skillRegistry.list());

    // Inject load_skill tool if not already present
    if (!this.context.tools.some(t => t.name === "load_skill")) {
      const loadSkill = createLoadSkillTool(this.skillRegistry);
      this.systemTools.push(loadSkill);
      this.context.tools = [...this.context.tools, loadSkill];
    }

    return diagnostics;
  }

  // ── Tool API ─────────────────────────────────────────────────────────────

  /**
   * Register a tool at runtime (incremental add).
   *
   * When `activate` is true (default) the tool is pushed to context.tools so
   * the LLM sees it on the next turn. Set to false to register without
   * activating — call setActiveTools() later to expose it.
   *
   * Overwrites if a tool with the same name already exists — updates both
   * the registry entry and (when active) the active-list reference.
   */
  registerTool(tool: ToolDef, activate = true): void {
    // Reject names that conflict with system-managed tools
    if (this.systemTools.some(t => t.name === tool.name)) {
      throw new Error(
        `[helix/runtime] Agent: cannot register tool "${tool.name}" — ` +
        `this name is reserved by the system.`
      );
    }
    if (this.registeredTools.has(tool.name)) {
      console.warn(`[helix/runtime] Agent: overwriting tool "${tool.name}"`);
    }
    this.registeredTools.set(tool.name, tool);

    if (!activate) return;

    const idx = this.context.tools.findIndex(t => t.name === tool.name);
    if (idx >= 0) {
      this.context.tools = [
        ...this.context.tools.slice(0, idx),
        tool,
        ...this.context.tools.slice(idx + 1),
      ];
    } else {
      this.context.tools = [...this.context.tools, tool];
    }
  }

  /**
   * Remove a tool from the registry and the active list.
   * No-op (with a warning) if the tool is not found.
   */
  removeTool(name: string): void {
    if (this.systemTools.some(t => t.name === name)) {
      console.warn(`[helix/runtime] Agent: removeTool("${name}") — system tools cannot be removed`);
      return;
    }
    if (!this.registeredTools.has(name)) {
      console.warn(`[helix/runtime] Agent: removeTool("${name}") — tool not found`);
      return;
    }
    this.registeredTools.delete(name);
    this.context.tools = this.context.tools.filter(t => t.name !== name);
  }

  /**
   * Set the active tool subset by name.
   *
   * Resolves names against the registered tool registry. Names that don't
   * match any registered tool are silently skipped. System-managed tools
   * (e.g. load_skill) are always preserved.
   */
  setActiveTools(names: string[]): void {
    const resolved: ToolDef[] = [];
    for (const n of names) {
      const t = this.registeredTools.get(n);
      if (t) {
        resolved.push(t);
      } else {
        console.warn(`[helix/runtime] Agent: setActiveTools — unknown tool "${n}", skipped`);
      }
    }

    this.context.tools = [...resolved, ...this.systemTools];
  }

  /**
   * Return all registered tools (the full registry, including inactive ones).
   */
  getRegisteredTools(): ToolDef[] {
    return [...this.registeredTools.values()];
  }

  /**
   * Programmatically invoke a skill by name.
   * Formats the skill content as a <skill> XML block and runs it as a user message.
   * Matches pi's AgentHarness.skill() behavior.
   */
  async invokeSkill(name: string, args?: string): Promise<void> {
    const skill = this.skillRegistry.get(name);
    if (!skill) {
      throw new Error(`[helix/runtime] Agent.invokeSkill(): unknown skill "${name}"`);
    }

    const skillBlock = formatSkillInvocation(skill);
    const input = args ? `${skillBlock}\n\n${args}` : skillBlock;
    return this.prompt(input);
  }

  /**
   * List all registered skills.
   */
  listSkills(): Skill[] {
    return this.skillRegistry.list();
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.skillRegistry.get(name);
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

  /**
   * Tool/model changes made during a turn (e.g. from subscribers or
   * steer/followUp handlers) take effect on the NEXT turn. This is
   * because agentLoop reads context.tools at the start of each loop
   * iteration to build a new ToolRegistry.
   */
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

// ─── Skill Invocation Formatting ──────────────────────────────────────────────

/**
 * Format a skill invocation as a <skill> XML block for user message injection.
 * Matches pi's formatSkillInvocation() behavior.
 */
function formatSkillInvocation(skill: Skill): string {
  const locationAttr = skill.filePath ? ` location="${skill.filePath}"` : "";
  const referencesLine = skill.filePath
    ? `References are relative to ${dirname(skill.filePath)}.\n\n`
    : "";
  return `<skill name="${skill.name}"${locationAttr}>\n${referencesLine}${skill.content}\n</skill>`;
}

function dirname(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}
