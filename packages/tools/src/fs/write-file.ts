import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "@helix/core";
import { resolveSafe } from "./read-file";

// ─── writeFileTool ────────────────────────────────────────────────────────────

export interface WriteFileOpts {
  /**
   * Restrict write access to this directory and its children.
   * @default process.cwd()
   */
  rootDir?: string;

  /**
   * If true, creates parent directories automatically.
   * @default true
   */
  createDirs?: boolean;

  /**
   * If false, prevents overwriting existing files.
   * @default true (allow overwrite)
   */
  allowOverwrite?: boolean;
}

interface WriteFileArgs {
  path: string;
  content: string;
  /**
   * Write mode:
   * - "overwrite" (default): replace the entire file
   * - "append": append to the end of the file
   */
  mode?: "overwrite" | "append";
}

/**
 * Write content to a file.
 *
 * Creates the file if it doesn't exist.
 * Creates parent directories if createDirs is true.
 * Path traversal is blocked.
 *
 * @example
 * const agent = new Agent({
 *   tools: [writeFileTool({ rootDir: "./src", allowOverwrite: true })],
 * })
 */
export function writeFileTool(opts: WriteFileOpts = {}): ToolDef {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const createDirs = opts.createDirs ?? true;
  const allowOverwrite = opts.allowOverwrite ?? true;

  return {
    name: "write_file",
    description:
      "Write content to a file. " +
      "Creates the file if it does not exist. " +
      "Use mode 'append' to add content to the end of an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the workspace root.",
        },
        content: {
          type: "string",
          description: "Content to write to the file.",
        },
        mode: {
          type: "string",
          enum: ["overwrite", "append"],
          description: "Write mode. Defaults to 'overwrite'.",
        },
      },
      required: ["path", "content"],
    },

    execute: async (args: unknown) => {
      const { path: filePath, content, mode = "overwrite" } = args as WriteFileArgs;

      const resolved = resolveSafe(rootDir, filePath);

      if (!allowOverwrite && fs.existsSync(resolved)) {
        throw new Error(`File already exists: ${filePath} (overwrite is disabled)`);
      }

      if (createDirs) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
      }

      if (mode === "append") {
        fs.appendFileSync(resolved, content, "utf8");
      } else {
        fs.writeFileSync(resolved, content, "utf8");
      }

      const stat = fs.statSync(resolved);

      return {
        path: filePath,
        mode,
        bytesWritten: Buffer.byteLength(content, "utf8"),
        totalSize: stat.size,
      };
    },
  };
}
