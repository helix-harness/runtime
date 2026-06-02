import type { Skill } from "@helix/core";

/**
 * Format skill name+description as XML for system prompt injection (progressive disclosure).
 * LLM sees the compact list and uses the load_skill tool to get full content.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  let prompt = "\n\nThe following skills provide specialized instructions for specific tasks.\n";
  prompt += "Use the load_skill tool to activate a skill when a task matches its description.\n\n";

  prompt += "<available_skills>\n";
  for (const skill of skills) {
    prompt += "  <skill>\n";
    prompt += `    <name>${escapeXml(skill.name)}</name>\n`;
    prompt += `    <description>${escapeXml(skill.description)}</description>\n`;
    prompt += "  </skill>\n";
  }
  prompt += "</available_skills>\n";

  return prompt;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
