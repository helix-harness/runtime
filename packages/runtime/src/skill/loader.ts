import type { Skill } from "@helix/core";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export type SkillDiagnosticCode =
  | "read_failed"
  | "parse_failed"
  | "missing_description"
  | "invalid_name";

export interface SkillDiagnostic {
  type: "warning";
  code: SkillDiagnosticCode;
  message: string;
  path: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export interface LoadSkillOptions {
  /** Project root for resolving relative paths. Default: process.cwd() */
  cwd?: string;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all skills from directories containing SKILL.md files.
 * Follows pi's discovery rules: if a directory has SKILL.md, treat it as skill root.
 */
export function loadSkills(dirs: string[], opts?: LoadSkillOptions): LoadSkillsResult {
  const cwd = opts?.cwd ?? process.cwd();
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const dir of dirs) {
    const absDir = resolve(cwd, dir);
    if (!existsSync(absDir)) continue;
    const result = loadSkillsFromDir(absDir, absDir);
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

/**
 * Load a single skill from a SKILL.md file.
 */
export function loadSkillFromFile(filePath: string): { skill: Skill | null; diagnostics: SkillDiagnostic[] } {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    return { skill: null, diagnostics: [{ type: "warning", code: "read_failed", message: "file not found", path: absPath }] };
  }
  try {
    const raw = readFileSync(absPath, "utf-8");
    return parseSkillFile(raw, absPath);
  } catch (err) {
    return {
      skill: null,
      diagnostics: [{ type: "warning", code: "read_failed", message: String(err), path: absPath }],
    };
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function loadSkillsFromDir(dir: string, rootDir: string): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const skillFile = join(dir, "SKILL.md");

  if (existsSync(skillFile)) {
    const result = loadSkillFromFile(skillFile);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics }; // do not recurse into skill directories
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { skills, diagnostics };
  }

  for (const entry of entries.sort()) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const result = loadSkillsFromDir(fullPath, rootDir);
        skills.push(...result.skills);
        diagnostics.push(...result.diagnostics);
      } else if (stat.isFile() && entry.endsWith(".md") && dir === rootDir) {
        // Only load direct .md files at the root level
        const result = loadSkillFromFile(fullPath);
        if (result.skill) skills.push(result.skill);
        diagnostics.push(...result.diagnostics);
      }
    } catch {
      // skip inaccessible entries
    }
  }

  return { skills, diagnostics };
}

function parseSkillFile(raw: string, filePath: string): { skill: Skill | null; diagnostics: SkillDiagnostic[] } {
  const diagnostics: SkillDiagnostic[] = [];
  const { frontmatter, body } = parseFrontmatter(raw);

  const dirName = basename(join(filePath, ".."));
  const name = frontmatter.name || dirName;

  // Validate description
  if (!frontmatter.description || frontmatter.description.trim() === "") {
    diagnostics.push({ type: "warning", code: "missing_description", message: "description is required", path: filePath });
    return { skill: null, diagnostics };
  }
  if (frontmatter.description.length > MAX_DESCRIPTION_LENGTH) {
    diagnostics.push({
      type: "warning",
      code: "missing_description",
      message: `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${frontmatter.description.length})`,
      path: filePath,
    });
  }

  // Validate name
  for (const error of validateName(name)) {
    diagnostics.push({ type: "warning", code: "invalid_name", message: error, path: filePath });
  }

  return {
    skill: {
      name,
      description: frontmatter.description,
      content: body,
      filePath,
    },
    diagnostics,
  };
}

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("name must not start or end with a hyphen");
  }
  if (name.includes("--")) {
    errors.push("name must not contain consecutive hyphens");
  }
  return errors;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return { frontmatter: {}, body: normalized };

  const yamlString = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();
  return { frontmatter: parseSimpleYaml(yamlString), body };
}

/**
 * Minimal YAML parser for flat key-value pairs.
 * Handles: key: value, key: "quoted value"
 * Does NOT handle nested structures or arrays.
 */
function parseSimpleYaml(yaml: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^([a-z_-]+):\s*(.+)?$/);
    if (!match) continue;
    const key = match[1]!.trim();
    const rawValue = match[2]?.trim();
    if (rawValue === undefined) continue;

    // Strip quotes
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
  }
  return result;
}
