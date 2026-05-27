import { Think } from "@cloudflare/think";
import { tool } from "ai";
import { z } from "zod";
import { createWorkersAI } from "workers-ai-provider";
import type { Session } from "agents/experimental/memory/session";
import { compilePanel } from "./panels";
import { Recall, type VectorizeBinding } from "./recall";
import type { LoopMessage, Memory, MemoryKind, Panel, ThreadSnapshot } from "./types";

export type LoopEnv = {
  AI: Ai;
  MEMORY?: VectorizeBinding;
  LOOP_MODEL?: string;
  LOOP_EMBED_MODEL?: string;
};

// Rolling window: the most recent KEEP_RECENT_MESSAGES stay verbatim in context.
// Anything older is embedded into Vectorize and dropped from Think's session, so
// the prompt size stops growing without us. The model can still recall earlier
// turns via the auto-generated `search_context` tool wired to the `recall` block.
const KEEP_RECENT_MESSAGES = 16;
const EVICT_BATCH = 4;

const SYSTEM_PROMPT = [
  "You are Loop, a persistent personal agent that answers in chat and ships working Svelte 5 artifacts.",
  "Speak plainly. Be specific. Avoid filler.",
  "When the user asks for an interface, panel, dashboard, widget, etc., call `panel` exactly once with `id`, `title`, and full Svelte 5 source.",
  "Reuse an existing panel id to revise it; pick a new kebab-case id for a new artifact.",
  "When the user asks to remove, delete, drop, kill, or unmount an artifact, call `delete_panel` with the matching id.",
  "Generated Svelte must use runes (`$state`, `$derived`, `$props`), no `export let`, no `on:click`, and stay self-contained (no external imports).",
  "When the user states a stable preference, decision, fact, failure lesson, or open loop, call `remember` once with the matching kind.",
  "This session has rolling memory: only the most recent turns stay verbatim in context. Earlier turns are searchable via `search_context` — use it if the user references something you don’t see directly.",
  "If none of the tools fit, reply directly with text.",
].join(" ");

export class Loop extends Think<LoopEnv> {
  private tablesReady = false;
  private recallCache: Recall | null = null;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })((this.env.LOOP_MODEL ?? "@cf/moonshotai/kimi-k2.6") as never);
  }

  getSystemPrompt() {
    return SYSTEM_PROMPT;
  }

  private getRecall(): Recall {
    if (!this.recallCache) this.recallCache = new Recall(this.env, this.name);
    return this.recallCache;
  }

  configureSession(session: Session): Session {
    const recall = this.getRecall();
    // Register a searchable recall block. Think auto-wires a `search_context`
    // tool the model can call to query Vectorize when older context is needed.
    return session.withContext("recall", {
      description: "Older turns from this session that fell out of the rolling window. Search by topic, intent, or remembered fact.",
      provider: {
        get: async () => null,
        search: async (query: string) => {
          const hits = await recall.search(query, 5);
          if (hits.length === 0) return null;
          return hits
            .map((h, i) => `[#${i + 1} · ${h.role} · score ${h.score.toFixed(3)}]\n${h.text}`)
            .join("\n\n");
        },
      },
    });
  }

  /**
   * After each successful turn, push any older messages out of the rolling
   * window into Vectorize. Best-effort: any failure leaves the message in
   * place rather than dropping it on the floor.
   */
  async onChatResponse(): Promise<void> {
    try {
      const all = await this.getMessages();
      const excess = all.length - KEEP_RECENT_MESSAGES;
      if (excess <= 0) return;
      const evictCount = Math.min(EVICT_BATCH, excess);
      const toEvict = all.slice(0, evictCount);
      this.ensureTables();
      const recall = this.getRecall();
      const evictedIds: string[] = [];
      for (const message of toEvict) {
        const role = message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = this.messageText(message);
        if (!text) continue;
        const ok = await recall.stash({ id: message.id, role, text, ts: Date.now() });
        if (ok) {
          evictedIds.push(message.id);
          this.ctx.storage.sql.exec("INSERT OR REPLACE INTO recalled (message_id, ts) VALUES (?, ?)", message.id, Date.now());
        }
      }
      if (evictedIds.length > 0) await this.session.deleteMessages(evictedIds);
    } catch (cause) {
      console.warn("[loop] recall eviction failed", cause);
    }
  }

  private messageText(message: { parts?: Array<{ type: string; text?: string }>; content?: unknown }): string {
    if (Array.isArray(message.parts)) {
      const text = message.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
      if (text.trim()) return text;
    }
    if (typeof message.content === "string" && message.content.trim()) return message.content;
    return "";
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
      delete_panel: tool({
        description: "Delete an artifact (panel) the user no longer wants. Provide the kebab-case panel id. Use this when the user says 'remove' or 'delete' or 'kill' a panel.",
        inputSchema: z.object({
          id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i, "use kebab-case ids"),
        }),
        execute: async ({ id }) => {
          this.ensureTables();
          const existed = this.panelRow(id);
          if (!existed) return { ok: false, panelId: id, status: "not-found" as const };
          this.ctx.storage.sql.exec("DELETE FROM panel_revisions WHERE panel_id = ?", id);
          this.ctx.storage.sql.exec("DELETE FROM panels WHERE id = ?", id);
          return { ok: true, panelId: id, status: "deleted" as const };
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
    // Forget recall entries in Vectorize first.
    try {
      const recalledIds = this.ctx.storage.sql
        .exec<{ message_id: string }>("SELECT message_id FROM recalled")
        .toArray()
        .map((r) => r.message_id);
      if (recalledIds.length > 0) await this.getRecall().forget(recalledIds);
    } catch { /* table might not exist on first reset; safe to skip */ }
    this.ensureTables();
    try { this.resetTurnState(); } catch { /* no active turn */ }
    // Think's clearMessages() only deletes rows matching the current sessionId.
    // Orphan rows from earlier sessions, plus the resumable-stream buffer, accumulate.
    // We wipe everything Think + agents/chat own, unconditionally.
    try { await this.clearMessages(); } catch { /* best-effort */ }
    const wipeSql = [
      "DELETE FROM assistant_messages",
      "DELETE FROM assistant_compactions",
      "DELETE FROM assistant_config",
      "DELETE FROM assistant_fts",
      "DELETE FROM cf_ai_chat_stream_chunks",
      "DELETE FROM cf_ai_chat_stream_metadata",
      "DELETE FROM cf_think_submissions",
      "DELETE FROM cf_agents_runs",
      "DELETE FROM cf_agents_facet_runs",
      "DELETE FROM cf_agents_fibers",
      "DELETE FROM cf_agent_tool_runs",
      "DELETE FROM cf_agent_tool_child_runs",
      "DELETE FROM think_config",
    ];
    for (const stmt of wipeSql) {
      try { this.ctx.storage.sql.exec(stmt); } catch { /* table may not exist on this Think version */ }
    }
    this.ctx.storage.sql.exec("DELETE FROM panels");
    this.ctx.storage.sql.exec("DELETE FROM panel_revisions");
    this.ctx.storage.sql.exec("DELETE FROM memories");
    try { this.ctx.storage.sql.exec("DELETE FROM recalled"); } catch { /* fresh DO */ }
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

  async deleteArtifact(id: string): Promise<{ ok: boolean }> {
    this.ensureTables();
    this.ctx.storage.sql.exec("DELETE FROM panel_revisions WHERE panel_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM panels WHERE id = ?", id);
    return { ok: true };
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
    // Track ids we've pushed into Vectorize so /api/reset can purge them too.
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS recalled (message_id TEXT PRIMARY KEY, ts INTEGER NOT NULL)");
    this.tablesReady = true;
  }

  private transcript(): LoopMessage[] {
    type RawPart = { type: string; text?: string; toolName?: string; input?: unknown; output?: unknown };
    type RawMessage = { id: string; role: string; parts?: Array<RawPart>; content?: unknown };
    const messages = (this as unknown as { messages?: Array<RawMessage> }).messages ?? [];
    return messages.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("")
        || (typeof message.content === "string" ? message.content : "");
      if (text.trim()) return [{ id: message.id, role: message.role, text, createdAt: "" }];
      // Surface tool-only assistant turns so the UI sees that the model acted, even without a text reply.
      if (message.role === "assistant") {
        const toolNames = parts
          .map((part) => {
            if (part.type === "tool-call" || part.type?.startsWith("tool-")) return part.toolName;
            return null;
          })
          .filter((name): name is string => typeof name === "string" && name.length > 0);
        if (toolNames.length > 0) {
          const unique = [...new Set(toolNames)];
          return [{ id: message.id, role: "assistant" as const, text: `· ${unique.join(" + ")}`, createdAt: "" }];
        }
      }
      return [];
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

