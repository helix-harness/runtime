import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "@helix/core";
import { truncate } from "../utils/truncate";

// ─── readFileTool ─────────────────────────────────────────────────────────────

export interface ReadFileOpts {
  /**
   * Restrict file access to this directory and its children.
   * Any path outside rootDir will be rejected.
   * @default process.cwd()
   */
  rootDir?: string;

  /**
   * Maximum characters to return. Prevents context window overflow.
   * @default 100_000
   */
  maxChars?: number;
}

interface ReadFileArgs {
  path: string;
  /** Optional: only return lines startLine..endLine (1-indexed, inclusive). */
  startLine?: number;
  endLine?: number;
}

/**
 * Read the contents of a file.
 *
 * LLM receives the file content as a string.
 * Large files are truncated with a notice.
 * Path traversal attacks are blocked.
 *
 * @example
 * const agent = new Agent({
 *   tools: [readFileTool({ rootDir: "./src" })],
 * })
 */
export function readFileTool(opts: ReadFileOpts = {}): ToolDef {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const maxChars = opts.maxChars ?? 100_000;

  return {
    name: "read_file",
    description:
      "Read the contents of a file. " +
      "Optionally specify startLine and endLine to read a slice. " +
      "Returns file content as a string.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the workspace root.",
        },
        startLine: {
          type: "number",
          description: "First line to return (1-indexed, inclusive). Optional.",
        },
        endLine: {
          type: "number",
          description: "Last line to return (1-indexed, inclusive). Optional.",
        },
      },
      required: ["path"],
    },

    execute: async (args: unknown) => {
      const { path: filePath, startLine, endLine } = args as ReadFileArgs;

      const resolved = resolveSafe(rootDir, filePath);

      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${filePath}`);
      }

      let content = fs.readFileSync(resolved, "utf8");

      // Line slice
      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split("\n");
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? endLine : lines.length;
        content = lines.slice(start, end).join("\n");
      }

      return {
        path: filePath,
        content: truncate(content, maxChars, "file"),
        size: stat.size,
        lines: content.split("\n").length,
      };
    },
  };
}

// ─── resolveSafe ──────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied path relative to rootDir.
 * Throws if the resolved path escapes rootDir (path traversal protection).
 */
export function resolveSafe(rootDir: string, userPath: string): string {
  const resolved = path.resolve(rootDir, userPath);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error(
      `Access denied: "${userPath}" is outside the workspace root (${rootDir})`
    );
  }
  return resolved;
}
