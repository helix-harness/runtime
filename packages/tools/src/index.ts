// ─── File System Tools ────────────────────────────────────────────────────────
export { readFileTool } from "./fs/read-file";
export type { ReadFileOpts } from "./fs/read-file";

export { writeFileTool } from "./fs/write-file";
export type { WriteFileOpts } from "./fs/write-file";

export { globTool } from "./fs/glob";
export type { GlobOpts } from "./fs/glob";

// ─── Shell Tools ──────────────────────────────────────────────────────────────
export { bashTool } from "./shell/bash";
export type { BashOpts } from "./shell/bash";

// ─── Utils (for custom tool authors) ─────────────────────────────────────────
export { truncate } from "./utils/truncate";
