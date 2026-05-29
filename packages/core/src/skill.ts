export interface Skill {
  /** Unique identifier. Lowercase, hyphenated. */
  name: string;
  /** Short description shown to LLM in system prompt. Max 1024 chars. */
  description: string;
  /** Skill instructions. Loaded on-demand via read tool (progressive disclosure). */
  content: string;
  /** Absolute path to the SKILL.md file. Used by read tool for progressive disclosure. */
  filePath: string;
}
