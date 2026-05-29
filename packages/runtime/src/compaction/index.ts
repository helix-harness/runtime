import type { AgentMessage, ModelAdapter } from "@helix/core";
import { getContentText, getContentTokens } from "@helix/core";
import { estimateTokens } from "../loop/run";

// ─── TransformContext type ────────────────────────────────────────────────────

export type TransformContextFn = (
  messages: AgentMessage[],
  signal?: AbortSignal
) => Promise<AgentMessage[]>;

// ─── sliceCompaction ──────────────────────────────────────────────────────────

/**
 * Simple slice-based compaction.
 * When message count or token count exceeds the threshold,
 * keeps only the most recent `keepLast` messages.
 *
 * Fast and deterministic. No LLM call required.
 * Loses older messages permanently (within the session).
 *
 * @example
 * const agent = new Agent({
 *   model,
 *   transformContext: sliceCompaction({ keepLast: 40 }),
 * })
 */
export function sliceCompaction(opts: {
  /** Keep the N most recent messages. Default: 40. */
  keepLast?: number;
  /** Only compact when message count exceeds this. Default: keepLast + 10. */
  triggerAt?: number;
}): TransformContextFn {
  const keepLast = opts.keepLast ?? 40;
  const triggerAt = opts.triggerAt ?? keepLast + 10;

  return async (messages) => {
    if (messages.length <= triggerAt) return messages;
    return messages.slice(-keepLast);
  };
}

// ─── tokenCompaction ─────────────────────────────────────────────────────────

/**
 * Token-aware slice compaction.
 * Walks backwards from the newest message, accumulating token estimates,
 * until keepRecentTokens is reached. Discards everything before that point.
 *
 * Closer to pi's compaction strategy. No LLM call required.
 *
 * @example
 * const agent = new Agent({
 *   model,
 *   transformContext: tokenCompaction({ keepRecentTokens: 20_000 }),
 * })
 */
export function tokenCompaction(opts: {
  /** Keep this many tokens of recent messages. Default: 20_000. */
  keepRecentTokens?: number;
  /** Only compact when total tokens exceed this. Default: keepRecentTokens * 1.5. */
  triggerAtTokens?: number;
}): TransformContextFn {
  const keepRecentTokens = opts.keepRecentTokens ?? 20_000;
  const triggerAtTokens = opts.triggerAtTokens ?? Math.floor(keepRecentTokens * 1.5);

  return async (messages) => {
    const total = estimateTokens(messages);
    if (total <= triggerAtTokens) return messages;

    // Walk backwards accumulating tokens until we hit keepRecentTokens
    let accumulated = 0;
    let cutIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = getContentTokens(messages[i]!.content);
      if (accumulated + tokens > keepRecentTokens) {
        cutIndex = i + 1;
        break;
      }
      accumulated += tokens;
      cutIndex = i;
    }

    return messages.slice(cutIndex);
  };
}

// ─── summaryCompaction ────────────────────────────────────────────────────────

/**
 * LLM-based summary compaction.
 * When tokens exceed the threshold, uses an LLM call to summarize older messages,
 * then replaces them with a single system message containing the summary.
 * Recent messages (keepRecentTokens worth) are kept verbatim.
 *
 * More expensive than slice/token compaction but preserves semantic content.
 *
 * @example
 * const agent = new Agent({
 *   model,
 *   transformContext: summaryCompaction({
 *     summaryModel: getModel({ model: "gpt-4o-mini", apiKey }),
 *     keepRecentTokens: 20_000,
 *   }),
 * })
 */
export function summaryCompaction(opts: {
  /** Model to use for generating summaries. Can be a cheaper/faster model. */
  summaryModel: ModelAdapter;
  /** Keep this many tokens of recent messages verbatim. Default: 20_000. */
  keepRecentTokens?: number;
  /** Only compact when total tokens exceed this. Default: keepRecentTokens * 1.5. */
  triggerAtTokens?: number;
  /** Custom instructions to focus the summary. */
  summaryInstructions?: string;
}): TransformContextFn {
  const keepRecentTokens = opts.keepRecentTokens ?? 20_000;
  const triggerAtTokens = opts.triggerAtTokens ?? Math.floor(keepRecentTokens * 1.5);

  return async (messages, signal) => {
    const total = estimateTokens(messages);
    if (total <= triggerAtTokens) return messages;

    // Find cut point: walk backwards keeping keepRecentTokens
    let accumulated = 0;
    let cutIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = getContentTokens(messages[i]!.content);
      if (accumulated + tokens > keepRecentTokens) {
        cutIndex = i + 1;
        break;
      }
      accumulated += tokens;
      cutIndex = i;
    }

    const toSummarize = messages.slice(0, cutIndex);
    const toKeep = messages.slice(cutIndex);

    if (toSummarize.length === 0) return messages;

    // Generate summary via LLM
    const summaryInstructions = opts.summaryInstructions ??
      "Summarize the following conversation concisely, preserving key facts, decisions, and context needed to continue the conversation.";

    const conversationText = toSummarize
      .map((m) => `[${m.role}]: ${getContentText(m.content)}`)
      .join("\n\n");

    const summaryMessages: AgentMessage[] = [
      {
        role: "user",
        content: `${summaryInstructions}\n\n---\n\n${conversationText}`,
        timestamp: Date.now(),
      },
    ];

    let summary = "";
    for await (const chunk of opts.summaryModel.stream(summaryMessages, { signal })) {
      if (chunk.type === "text_delta") summary += chunk.value;
    }

    // Replace old messages with summary + recent messages
    const summaryMessage: AgentMessage = {
      role: "system",
      content: `[Conversation summary — ${toSummarize.length} messages condensed]\n\n${summary}`,
      timestamp: Date.now(),
    };

    return [summaryMessage, ...toKeep];
  };
}

// ─── compose ──────────────────────────────────────────────────────────────────

/**
 * Compose multiple transformContext functions, running them left to right.
 *
 * @example
 * transformContext: compose(
 *   withRAG({ retriever: myDB }),
 *   tokenCompaction({ keepRecentTokens: 20_000 }),
 * )
 */
export function compose(...fns: TransformContextFn[]): TransformContextFn {
  return async (messages, signal) => {
    let result = messages;
    for (const fn of fns) {
      result = await fn(result, signal);
    }
    return result;
  };
}
