/**
 * Truncate a string to maxChars, appending a notice if truncated.
 * Used by all tools to prevent context window overflow.
 */
export function truncate(
  content: string,
  maxChars: number,
  label = "output"
): string {
  if (content.length <= maxChars) return content;
  const kept = content.slice(0, maxChars);
  const dropped = content.length - maxChars;
  return `${kept}\n\n[${label} truncated — ${dropped} more chars not shown]`;
}
