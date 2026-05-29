import type { ContentPart, ImageMediaType } from "./message";

/**
 * 单张图片的 token 估算上限。
 * - Anthropic: ~1600 tokens（1568px 最长边）
 * - OpenAI high detail: ~4000+ tokens（2048px 最长边）
 * 取高值以确保 compaction 不会低估导致溢出。
 */
const IMAGE_TOKEN_ESTIMATE = 4096;

export function textPart(text: string): ContentPart {
  return { type: "text", text };
}

export function imagePart(data: string, mimeType: ImageMediaType = "image/png"): ContentPart {
  // data: 始终存纯 base64（不含 data: 前缀），前缀在适配层拼接
  const pure = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  return { type: "image", data: pure, mimeType };
}

/**
 * 从 content 中提取纯文本。
 * - string → 原样返回
 * - ContentPart[] → 拼接所有 text part，图片占位为 "[image]"
 *
 * 适用于 system prompt 提取、summary 生成、toolResult 等纯文本场景。
 */
export function getContentText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  if (content.length === 0) return "";
  return content
    .map((p) => (p.type === "text" ? p.text : "[image]"))
    .join("");
}

export function getContentTokens(content: string | ContentPart[]): number {
  if (typeof content === "string") return Math.ceil(content.length / 4);
  if (content.length === 0) return 0;
  let total = 0;
  for (const p of content) {
    if (p.type === "text") total += Math.ceil(p.text.length / 4);
    else if (p.type === "image") total += IMAGE_TOKEN_ESTIMATE;
  }
  return total;
}
