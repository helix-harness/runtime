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

const SUMMARY_MARKER = "[Conversation summary";

function extractPreviousSummary(messages: AgentMessage[]): string | null {
  const first = messages[0];
  if (first?.role !== "system") return null;
  const text = getContentText(first.content);
  if (!text.startsWith(SUMMARY_MARKER)) return null;
  const idx = text.indexOf("\n\n");
  return idx >= 0 ? text.slice(idx + 2) : null;
}

const SUMMARIZATION_SYSTEM_PROMPT = `你是一个上下文摘要助手。你的任务是按照指定格式生成结构化摘要。

不要继续对话。不要回答对话中的任何问题。只输出结构化摘要。`;

const SUMMARY_INSTRUCTIONS = `上述消息是一段需要总结的对话。请创建一份结构化的上下文检查点摘要，供其他 LLM 继续工作使用。

请严格按照以下格式输出：

## 目标
[用户想要完成什么？]

## 约束与偏好
- [用户提到的任何约束、偏好或要求]
- [如果没有则写 "(无)"]

## 进度
### 已完成
- [x] [已完成的任务/更改]

### 进行中
- [ ] [当前工作]

### 阻塞
- [阻碍进度的问题]

## 关键决策
- **[决策]**: [简要理由]

## 下一步
1. [接下来应该做什么，按顺序列出]

## 关键上下文
- [继续工作所需的数据、示例或引用]
- [如果不适用则写 "(无)"]

保持每个部分简洁。保留精确的文件路径、函数名和错误信息。`;

const UPDATE_INSTRUCTIONS = `上述消息是新对话消息，需要合并到 <previous-summary> 标签中提供的现有摘要中。

使用新信息更新现有结构化摘要。规则：
- 保留现有摘要中的所有信息
- 添加新消息中的进度、决策和上下文
- 更新进度部分：将已完成的项目从"进行中"移到"已完成"
- 根据已完成的内容更新"下一步"
- 保留精确的文件路径、函数名和错误信息
- 如果某些内容不再相关，可以移除

请严格按照以下格式输出：

## 目标
[保留现有目标，如果任务扩展则添加新目标]

## 约束与偏好
- [保留现有内容，添加新发现的约束]

## 进度
### 已完成
- [x] [包含之前已完成的项目和新完成的项目]

### 进行中
- [ ] [当前工作 - 根据进度更新]

### 阻塞
- [当前阻塞项 - 如果已解决则移除]

## 关键决策
- **[决策]**: [简要理由]（保留所有之前的决策，添加新的）

## 下一步
1. [根据当前状态更新]

## 关键上下文
- [保留重要上下文，如有需要则添加]

保持每个部分简洁。保留精确的文件路径、函数名和错误信息。`;

/**
 * LLM-based summary compaction.
 * When tokens exceed the threshold, uses an LLM call to summarize older messages,
 * then replaces them with a single system message containing the summary.
 * Recent messages (keepRecentTokens worth) are kept verbatim.
 *
 * Supports incremental updates: when a previous compaction summary exists,
 * it is passed to the LLM as context for merging rather than summarizing from scratch.
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
  /** Custom instructions for the initial summary (first compaction). Default: structured format. */
  summaryInstructions?: string;
  /** Custom instructions for incremental update (subsequent compactions). */
  updateInstructions?: string;
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

    // Check for previous compaction summary (incremental update)
    const previousSummary = extractPreviousSummary(messages);

    // Filter out old summary message to avoid duplication
    const messagesToSummarize = previousSummary
      ? toSummarize.filter(m => !(m.role === "system" && getContentText(m.content).startsWith(SUMMARY_MARKER)))
      : toSummarize;

    const conversationText = messagesToSummarize
      .map((m) => `[${m.role}]: ${getContentText(m.content)}`)
      .join("\n\n");

    let prompt: string;
    if (previousSummary) {
      // Incremental update: merge new messages into existing summary
      const updateInstructions = opts.updateInstructions ?? UPDATE_INSTRUCTIONS;
      const conversationBlock = conversationText
        ? `<conversation>\n${conversationText}\n</conversation>\n\n`
        : "";
      prompt = `${conversationBlock}<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${updateInstructions}`;
    } else {
      // First compaction: generate summary from scratch
      const summaryInstructions = opts.summaryInstructions ?? SUMMARY_INSTRUCTIONS;
      prompt = `<conversation>\n${conversationText}\n</conversation>\n\n${summaryInstructions}`;
    }

    const summaryMessages: AgentMessage[] = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    let summary = "";
    for await (const chunk of opts.summaryModel.stream(summaryMessages, {
      signal,
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    })) {
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
