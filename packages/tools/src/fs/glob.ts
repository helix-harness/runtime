import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "@helix/core";

// ─── globTool ─────────────────────────────────────────────────────────────────

export interface GlobOpts {
  /**
   * Root directory to search within.
   * @default process.cwd()
   */
  rootDir?: string;

  /**
   * Maximum number of results to return.
   * @default 200
   */
  maxResults?: number;

  /**
   * Directories to always exclude from results.
   * @default ["node_modules", ".git", "dist", ".next", "build", "coverage", ".turbo"]
   */
  excludeDirs?: string[];
}

interface GlobArgs {
  pattern: string;
  /**
   * Optional subdirectory to search in (relative to rootDir).
   * Useful for scoping searches.
   */
  cwd?: string;
}

/**
 * Find files matching a glob pattern.
 *
 * Uses a built-in recursive directory walker — no external glob dependency.
 * Supports * (any chars except /) and ** (any path segments).
 *
 * @example
 * const agent = new Agent({
 *   tools: [globTool({ rootDir: "./src" })],
 * })
 * // LLM can call: glob({ pattern: "**\/*.ts" })
 */
export function globTool(opts: GlobOpts = {}): ToolDef {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const maxResults = opts.maxResults ?? 200;
  const excludeDirs = new Set(
    opts.excludeDirs ?? ["node_modules", ".git", "dist", ".next", "build", "coverage", ".turbo"]
  );

  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. " +
      "Supports * (any chars in a segment) and ** (any path depth). " +
      "Returns a list of matching file paths relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern, e.g. '**/*.ts', 'src/**/*.test.ts', '*.json'.",
        },
        cwd: {
          type: "string",
          description:
            "Optional subdirectory to search in. Defaults to workspace root.",
        },
      },
      required: ["pattern"],
    },

    execute: async (args: unknown) => {
      const { pattern, cwd } = args as GlobArgs;

      const searchRoot = cwd
        ? path.resolve(rootDir, cwd)
        : rootDir;

      // Validate cwd is within rootDir
      if (!searchRoot.startsWith(rootDir)) {
        throw new Error(`cwd "${cwd}" is outside the workspace root`);
      }

      if (!fs.existsSync(searchRoot)) {
        throw new Error(`Directory not found: ${cwd ?? "."}`);
      }

      const regex = globToRegex(pattern);
      const results: string[] = [];

      walkDir(searchRoot, searchRoot, regex, excludeDirs, results, maxResults);

      return {
        pattern,
        cwd: cwd ?? ".",
        count: results.length,
        truncated: results.length >= maxResults,
        files: results,
      };
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function walkDir(
  baseDir: string,
  currentDir: string,
  regex: RegExp,
  excludeDirs: Set<string>,
  results: string[],
  maxResults: number
): void {
  if (results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return; // permission denied or other error
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      walkDir(
        baseDir,
        path.join(currentDir, entry.name),
        regex,
        excludeDirs,
        results,
        maxResults
      );
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, path.join(currentDir, entry.name));
      // Normalize to forward slashes for consistent matching across OSes
      const normalized = rel.split(path.sep).join("/");
      if (regex.test(normalized)) {
        results.push(normalized);
      }
    }
  }
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: * (any chars except /) and ** (any path).
 */
function globToRegex(pattern: string): RegExp {
  const normalized = pattern.split(path.sep).join("/");
  let regexStr = "^";

  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        // ** matches any path including slashes
        regexStr += ".*";
        i += 2;
        // Skip trailing slash after **
        if (normalized[i] === "/") i++;
      } else {
        // * matches any chars except /
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      regexStr += "\\" + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr);
}
