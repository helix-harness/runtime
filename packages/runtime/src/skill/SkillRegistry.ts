import type { Skill } from "@helix/core";

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      console.warn(`[helix/runtime] SkillRegistry: overwriting skill "${skill.name}"`);
    }
    this.skills.set(skill.name, skill);
  }

  registerAll(skills: Skill[]): void {
    for (const skill of skills) this.register(skill);
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
