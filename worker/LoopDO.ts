import { Think } from "@cloudflare/think";
import { tool } from "ai";
import { z } from "zod";
import { createWorkersAI } from "workers-ai-provider";
import { compilePanel } from "./panels";
import type { LoopMessage, Memory, MemoryKind, Panel, ThreadSnapshot } from "./types";

export type LoopEnv = {
  AI: Ai;
  LOOP_MODEL?: string;
};

const SYSTEM_PROMPT = [
  "You are Loop, a persistent personal agent runtime.",
  "Speak plainly. Be specific. Avoid filler.",
  "When the user asks for an interface, panel, surface, dashboard, status, etc., call `panel` exactly once with `id`, `title`, and full Svelte 5 source.",
  "Reuse an existing panel id to revise it; pick a new kebab-case id for a new surface.",
  "Generated Svelte must use runes (`$state`, `$derived`, `$props`), no `export let`, no `on:click`, and stay self-contained (no external imports).",
  "When the user states a stable preference, decision, fact, failure lesson, or open loop, call `remember` once with the matching kind.",
  "If neither tool fits, reply directly with text.",
].join(" ");

export class Loop extends Think<LoopEnv> {
  private tablesReady = false;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })((this.env.LOOP_MODEL ?? "@cf/moonshotai/kimi-k2.6") as never);
  }

  getSystemPrompt() {
    return SYSTEM_PROMPT;
  }

  getTools() {
    return {
      panel: tool({
        description: "Create or revise a live Svelte 5 panel mounted in Loop's runtime surface. Use a new kebab-case id for new panels, or an existing id to revise.",
        inputSchema: z.object({
          id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i, "use kebab-case ids"),
          title: z.string().min(1).max(120),
          source: z.string().min(1),
          pinned: z.boolean().optional().default(true),
        }),
        execute: async ({ id, title, source, pinned }) => {
          this.ensureTables();
          const revision = await compilePanel({ id, title, source });
          const existing = this.panelRow(id);
          if (existing && existing.sourceHash === revision.sourceHash && existing.pinned === (pinned !== false)) {
            return { ok: true, panelId: id, status: "unchanged" as const, sourceHash: revision.sourceHash };
          }
          this.ctx.storage.sql.exec(
            "INSERT INTO panel_revisions (id, panel_id, title, source, source_hash, client_js, css, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            revision.id, revision.panelId, revision.title, revision.source, revision.sourceHash,
            revision.clientJs, revision.css, revision.createdAt,
          );
          this.ctx.storage.sql.exec(
            "INSERT INTO panels (id, title, pinned, active_revision_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, pinned=excluded.pinned, active_revision_id=excluded.active_revision_id, updated_at=excluded.updated_at",
            id, title, pinned === false ? 0 : 1, revision.id, revision.createdAt,
          );
          return {
            ok: true,
            panelId: id,
            status: existing ? "revised" as const : "created" as const,
            sourceHash: revision.sourceHash,
          };
        },
      }),
      remember: tool({
        description: "Commit a durable memory: a preference, decision, fact, failure lesson, or open loop. Use exact wording requested by the user.",
        inputSchema: z.object({
          kind: z.enum(["preference", "decision", "fact", "failure", "open_loop"]),
          text: z.string().min(1).max(2000),
        }),
        execute: async ({ kind, text }) => {
          this.ensureTables();
          const cleaned = text.trim();
          const prior = this.ctx.storage.sql.exec<{ id: string }>(
            "SELECT id FROM memories WHERE kind = ? AND text = ? AND state = 'kept' LIMIT 1",
            kind, cleaned,
          ).toArray()[0];
          if (prior) return { ok: true, memoryId: prior.id, status: "duplicate" as const };
          const id = crypto.randomUUID();
          const committedAt = new Date().toISOString();
          this.ctx.storage.sql.exec(
            "INSERT INTO memories (id, kind, text, committed_at, state) VALUES (?, ?, ?, ?, 'kept')",
            id, kind, cleaned, committedAt,
          );
          return { ok: true, memoryId: id, kind, status: "committed" as const };
        },
      }),
    };
  }

  async resetThread(): Promise<ThreadSnapshot> {
    this.ensureTables();
    // Abort any in-flight turn, drop Think's transcript, and wipe Loop's tables.
    try { this.resetTurnState(); } catch { /* no active turn */ }
    await this.clearMessages();
    this.ctx.storage.sql.exec("DELETE FROM panels");
    this.ctx.storage.sql.exec("DELETE FROM panel_revisions");
    this.ctx.storage.sql.exec("DELETE FROM memories");
    // Defensive: hit any Think-owned message tables we can find. Names are heuristic;
    // failures are swallowed because the schema may differ across Think versions.
    for (const table of ["messages", "think_messages", "chat_messages", "streams", "think_streams"]) {
      try { this.ctx.storage.sql.exec(`DELETE FROM ${table}`); } catch { /* not present */ }
    }
    // Verify by reading back the transcript through Think's own getter; if anything
    // remains, clearMessages again with one more pass.
    const remaining = await this.getMessages().catch(() => []);
    if (remaining.length > 0) await this.clearMessages().catch(() => undefined);
    return this.loopSnapshot();
  }

  async loopSnapshot(): Promise<ThreadSnapshot> {
    this.ensureTables();
    const transcript = this.transcript();
    return {
      messages: transcript,
      panels: this.panels(),
      memories: this.memoriesRows(),
      stats: {
        messageCount: transcript.length,
        panelCount: this.scalarInt("SELECT COUNT(*) AS n FROM panels"),
        memoryCount: this.scalarInt("SELECT COUNT(*) AS n FROM memories WHERE state = 'kept'"),
      },
    };
  }

  async signalMemory(id: string, state: "wrong" | "forgotten"): Promise<Memory | null> {
    this.ensureTables();
    const existing = this.ctx.storage.sql.exec<{ id: string; kind: MemoryKind; text: string; committed_at: string }>(
      "SELECT id, kind, text, committed_at FROM memories WHERE id = ?",
      id,
    ).toArray()[0];
    if (!existing) return null;
    this.ctx.storage.sql.exec("UPDATE memories SET state = ? WHERE id = ?", state, id);
    return { id: existing.id, kind: existing.kind, text: existing.text, committedAt: existing.committed_at, state };
  }

  async exportLedger() {
    this.ensureTables();
    return {
      format: "loop-ledger-v1",
      exportedAt: new Date().toISOString(),
      snapshot: await this.loopSnapshot(),
      panelRevisions: this.ctx.storage.sql.exec<{
        id: string; panel_id: string; title: string; source: string;
        source_hash: string; created_at: string;
      }>(
        "SELECT id, panel_id, title, source, source_hash, created_at FROM panel_revisions ORDER BY created_at ASC",
      ).toArray(),
    };
  }

  private ensureTables() {
    if (this.tablesReady) return;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, committed_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'kept')");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL, active_revision_id TEXT NOT NULL, updated_at TEXT NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS panel_revisions (id TEXT PRIMARY KEY, panel_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, source_hash TEXT NOT NULL, client_js TEXT NOT NULL, css TEXT NOT NULL, created_at TEXT NOT NULL)");
    this.tablesReady = true;
  }

  private transcript(): LoopMessage[] {
    const messages = (this as unknown as { messages?: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }>; content?: unknown }> }).messages ?? [];
    return messages.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = Array.isArray(message.parts)
        ? message.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("")
        : typeof message.content === "string" ? message.content : "";
      if (!text.trim()) return [];
      return [{ id: message.id, role: message.role, text, createdAt: "" }];
    });
  }

  private panels(): Panel[] {
    return this.ctx.storage.sql.exec<{
      id: string; title: string; pinned: number; active_revision_id: string; updated_at: string;
      revision_id: string; source: string; source_hash: string; client_js: string; css: string; created_at: string;
    }>(`SELECT p.id, p.title, p.pinned, p.active_revision_id, p.updated_at,
               r.id AS revision_id, r.source, r.source_hash, r.client_js, r.css, r.created_at
        FROM panels p JOIN panel_revisions r ON r.id = p.active_revision_id
        ORDER BY p.updated_at DESC`).toArray().map((row) => ({
      id: row.id,
      title: row.title,
      pinned: row.pinned === 1,
      activeRevisionId: row.active_revision_id,
      updatedAt: row.updated_at,
      revision: {
        id: row.revision_id,
        panelId: row.id,
        title: row.title,
        source: row.source,
        sourceHash: row.source_hash,
        clientJs: row.client_js,
        css: row.css,
        svelteVersion: "5",
        createdAt: row.created_at,
      },
    }));
  }

  private memoriesRows(): Memory[] {
    return this.ctx.storage.sql.exec<{ id: string; kind: MemoryKind; text: string; committed_at: string; state: Memory["state"] }>(
      "SELECT id, kind, text, committed_at, state FROM memories ORDER BY committed_at DESC",
    ).toArray().map((row) => ({
      id: row.id,
      kind: row.kind,
      text: row.text,
      committedAt: row.committed_at,
      state: row.state,
    }));
  }

  private panelRow(id: string) {
    return this.ctx.storage.sql.exec<{ source_hash: string; pinned: number }>(
      "SELECT r.source_hash AS source_hash, p.pinned AS pinned FROM panels p JOIN panel_revisions r ON r.id = p.active_revision_id WHERE p.id = ?",
      id,
    ).toArray().map((row) => ({ sourceHash: row.source_hash, pinned: row.pinned === 1 }))[0];
  }

  private scalarInt(sql: string): number {
    try {
      const row = this.ctx.storage.sql.exec<{ n: number }>(sql).toArray()[0];
      return row?.n ?? 0;
    } catch {
      return 0;
    }
  }
}

