import type { AgentMessage } from "@helix/core";
import * as fs from "fs";
import * as path from "path";

// ─── SessionStore Interface ───────────────────────────────────────────────────

export interface SessionData {
  id: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt: string;
  messages: AgentMessage[];
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  create(opts?: Partial<Pick<SessionData, "systemPrompt" | "metadata">>): Promise<SessionData>;
  get(id: string): Promise<SessionData | undefined>;
  save(session: SessionData): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

// ─── MemorySessionStore ───────────────────────────────────────────────────────

/**
 * In-memory session store. Data is lost when the process exits.
 * Default store used by Agent when no store is provided.
 */
export class MemorySessionStore implements SessionStore {
  private store = new Map<string, SessionData>();

  async create(opts?: Partial<Pick<SessionData, "systemPrompt" | "metadata">>): Promise<SessionData> {
    const session: SessionData = {
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: opts?.systemPrompt ?? "",
      messages: [],
      metadata: opts?.metadata,
    };
    this.store.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<SessionData | undefined> {
    return this.store.get(id);
  }

  async save(session: SessionData): Promise<void> {
    this.store.set(session.id, { ...session, updatedAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

// ─── FileSessionStore ─────────────────────────────────────────────────────────

/**
 * File-based session store. Each session is stored as a JSONL file.
 * Session metadata is in a separate .meta.json file.
 *
 * @example
 * const store = new FileSessionStore("./sessions")
 * const session = await store.create({ systemPrompt: "You are helpful." })
 *
 * // Later process:
 * const loaded = await store.get(session.id)
 */
export class FileSessionStore implements SessionStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private metaPath(id: string) {
    return path.join(this.dir, `${id}.meta.json`);
  }

  private messagesPath(id: string) {
    return path.join(this.dir, `${id}.jsonl`);
  }

  async create(opts?: Partial<Pick<SessionData, "systemPrompt" | "metadata">>): Promise<SessionData> {
    const session: SessionData = {
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: opts?.systemPrompt ?? "",
      messages: [],
      metadata: opts?.metadata,
    };
    await this.save(session);
    return session;
  }

  async get(id: string): Promise<SessionData | undefined> {
    if (!fs.existsSync(this.metaPath(id))) return undefined;
    const meta = JSON.parse(fs.readFileSync(this.metaPath(id), "utf8"));
    const messages = this.readMessages(id);
    return { ...meta, messages };
  }

  async save(session: SessionData): Promise<void> {
    const { messages, ...meta } = session;
    fs.writeFileSync(this.metaPath(session.id), JSON.stringify({ ...meta, updatedAt: Date.now() }, null, 2));
    fs.writeFileSync(this.messagesPath(session.id), messages.map((m) => JSON.stringify(m)).join("\n"), "utf8");
  }

  async delete(id: string): Promise<void> {
    [this.metaPath(id), this.messagesPath(id)].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }

  async list(): Promise<string[]> {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => f.replace(".meta.json", ""));
  }

  private readMessages(id: string): AgentMessage[] {
    const p = this.messagesPath(id);
    if (!fs.existsSync(p)) return [];
    const content = fs.readFileSync(p, "utf8").trim();
    if (!content) return [];
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
