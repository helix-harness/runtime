import type { ToolDef } from "@helix/core";
import type { SkillRegistry } from "./SkillRegistry";

interface LoadSkillArgs {
  name: string;
}

/**
 * Create a load_skill tool backed by a SkillRegistry.
 * This is the unified activation channel for all skills (file-based and memory).
 */
export function createLoadSkillTool(registry: SkillRegistry): ToolDef {
  return {
    name: "load_skill",
    description: "Load and activate a skill by name. Returns the skill's full instructions.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name from the available_skills list",
        },
      },
      required: ["name"],
    },
    execute: async (args) => {
      const { name } = args as LoadSkillArgs;
      const skill = registry.get(name);
      if (!skill) return { error: `Unknown skill: ${name}` };
      return { content: skill.content };
    },
  };
}
