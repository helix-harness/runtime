import type { Skill } from "@helix/core";
import type { SkillDiagnostic } from "./loader";
import { validateName, validateDescription } from "./loader";

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Register a skill with validation. Returns diagnostics for any issues. */
  register(skill: Skill): SkillDiagnostic[] {
    const diagnostics: SkillDiagnostic[] = [];
    const path = skill.filePath ?? `<memory:${skill.name}>`;

    for (const error of validateName(skill.name)) {
      diagnostics.push({ type: "warning", code: "invalid_name", message: error, path });
    }

    const descErrors = validateDescription(skill.description);
    for (const error of descErrors) {
      diagnostics.push({ type: "warning", code: "missing_description", message: error, path });
    }
    if (descErrors.some(e => e === "description is required")) {
      return diagnostics;
    }

    if (this.skills.has(skill.name)) {
      console.warn(`[helix/runtime] SkillRegistry: overwriting skill "${skill.name}"`);
    }
    this.skills.set(skill.name, skill);
    return diagnostics;
  }

  registerAll(skills: Skill[]): SkillDiagnostic[] {
    return skills.flatMap(s => this.register(s));
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  remove(name: string): boolean {
    return this.skills.delete(name);
  }

  clear(): void {
    this.skills.clear();
  }
}
