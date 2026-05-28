import { execSync, spawnSync } from "child_process";
import * as path from "path";
import * as os from "os";
import type { ToolDef } from "@helix/core";
import { truncate } from "../utils/truncate";

// ─── bashTool ─────────────────────────────────────────────────────────────────

export interface BashOpts {
  /**
   * Working directory for command execution.
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * Maximum characters to return from stdout + stderr combined.
   * @default 20_000
   */
  maxOutputChars?: number;

  /**
   * Maximum time to wait for a command to complete (ms).
   * @default 30_000 (30 seconds)
   */
  timeoutMs?: number;

  /**
   * Allowlist of command prefixes. If set, any command not starting with
   * one of these prefixes will be rejected.
   *
   * @example ["ls", "cat", "grep", "git", "npm", "pnpm", "tsc", "node"]
   */
  allowedCommands?: string[];

  /**
   * Blocklist of dangerous patterns. Commands matching any of these will
   * be rejected even if they pass the allowlist.
   *
   * @default ["rm -rf /", ":(){ :|:& };:", "> /dev/sda"] (fork bombs, disk wipes)
   */
  blockedPatterns?: RegExp[];

  /**
   * Environment variables to inject into the command.
   * Merges with process.env.
   */
  env?: Record<string, string>;
}

interface BashArgs {
  command: string;
  /**
   * Optional: override the working directory for this specific command.
   * Must be a subdirectory of opts.cwd.
   */
  cwd?: string;
}

const DEFAULT_BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/, // rm -rf /
  /:\(\)\s*\{.*:\|:.*\}/, // fork bomb
  />\s*\/dev\/sd[a-z]/, // write to block device
  /mkfs\./, // format filesystem
  /dd\s+if=.*of=\/dev\//, // dd to device
];

/**
 * Execute a bash command in a subprocess.
 *
 * Security features:
 * - allowedCommands: whitelist command prefixes
 * - blockedPatterns: block dangerous command patterns
 * - timeoutMs: kill runaway commands
 * - maxOutputChars: prevent context window overflow
 * - cwd restriction: commands run in a controlled directory
 *
 * @example
 * const agent = new Agent({
 *   tools: [bashTool({
 *     cwd: "./workspace",
 *     allowedCommands: ["ls", "cat", "grep", "git", "npm run", "tsc"],
 *     timeoutMs: 15_000,
 *   })],
 * })
 */
export function bashTool(opts: BashOpts = {}): ToolDef {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const maxOutputChars = opts.maxOutputChars ?? 20_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const allowedCommands = opts.allowedCommands;
  const blockedPatterns = [
    ...DEFAULT_BLOCKED_PATTERNS,
    ...(opts.blockedPatterns ?? []),
  ];

  return {
    name: "bash",
    description:
      "Execute a bash command and return stdout + stderr. " +
      "Use for running scripts, tests, linting, compiling, or inspecting files. " +
      "Commands time out after " + (timeoutMs / 1000) + "s.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The bash command to execute. " +
            "Use && to chain commands. " +
            "Avoid interactive commands (they will time out).",
        },
        cwd: {
          type: "string",
          description: "Optional working directory for this command.",
        },
      },
      required: ["command"],
    },

    execute: async (args: unknown) => {
      const { command, cwd: cmdCwd } = args as BashArgs;

      // ── Security checks ──────────────────────────────────────────────────

      // Blocked patterns (checked before allowlist)
      for (const pattern of blockedPatterns) {
        if (pattern.test(command)) {
          throw new Error(
            `Command blocked: matches dangerous pattern "${pattern.source}"`
          );
        }
      }

      // Allowlist check
      if (allowedCommands && allowedCommands.length > 0) {
        const trimmed = command.trimStart();
        const allowed = allowedCommands.some((prefix) =>
          trimmed === prefix || trimmed.startsWith(prefix + " ")
        );
        if (!allowed) {
          throw new Error(
            `Command not allowed: "${trimmed.split(" ")[0]}". ` +
            `Allowed prefixes: ${allowedCommands.join(", ")}`
          );
        }
      }

      // Working directory
      let execCwd = cwd;
      if (cmdCwd) {
        execCwd = path.resolve(cwd, cmdCwd);
        if (!execCwd.startsWith(cwd)) {
          throw new Error(
            `cwd "${cmdCwd}" is outside the workspace root`
          );
        }
      }

      // ── Execute ──────────────────────────────────────────────────────────

      const start = Date.now();

      const result = spawnSync("bash", ["-c", command], {
        cwd: execCwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB raw buffer
        encoding: "utf8",
        env: {
          ...process.env,
          ...(opts.env ?? {}),
          // Ensure non-interactive mode
          TERM: "dumb",
          CI: "1",
        },
      });

      const durationMs = Date.now() - start;

      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const combined = stdout + (stderr ? "\n[stderr]\n" + stderr : "");
      const output = truncate(combined, maxOutputChars, "output");

      const timedOut = result.signal === "SIGTERM" && durationMs >= timeoutMs;
      if (timedOut) {
        return {
          success: false,
          exitCode: -1,
          output: output + `\n\n[Command timed out after ${timeoutMs}ms]`,
          durationMs,
          timedOut: true,
        };
      }

      return {
        success: result.status === 0,
        exitCode: result.status ?? -1,
        output,
        durationMs,
        timedOut: false,
      };
    },
  };
}
