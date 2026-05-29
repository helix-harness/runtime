import type { Skill } from "@helix/core";

/**
 * Format skill name+description as XML for system prompt injection (progressive disclosure).
 * LLM sees the compact list and uses read tool or load_skill to get full content.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  let prompt = "\n\nThe following skills provide specialized instructions for specific tasks.\n";
  prompt += "When a skill has a location, use the read tool to load its file when the task matches its description.\n";
  prompt += "When a skill has no location, use the load_skill tool to activate it.\n\n";

  prompt += "<available_skills>\n";
  for (const skill of skills) {
    prompt += "  <skill>\n";
    prompt += `    <name>${escapeXml(skill.name)}</name>\n`;
    prompt += `    <description>${escapeXml(skill.description)}</description>\n`;
    if (skill.filePath) {
      prompt += `    <location>${escapeXml(skill.filePath)}</location>\n`;
    }
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
