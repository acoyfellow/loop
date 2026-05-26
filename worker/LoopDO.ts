import { DurableObject } from "cloudflare:workers";
import { buildRollingPrompt, createCheckpoint, shouldCheckpoint } from "./context";
import { compilePanel } from "./panels";
import type { LoopEvent, Memory, MemoryKind, Panel, ThreadSnapshot, ToolAction } from "./types";

export type LoopEnv = { AI: Ai; LOOP_MODEL?: string };
type ExecuteResult = { snapshot: ThreadSnapshot; appendedEventIds: string[] };
type TurnState = { id: string; userEventId: string; status: "running" | "complete" | "failed"; createdAt: string; updatedAt: string; error?: string };

export class LoopDO extends DurableObject<LoopEnv> {
  private ready = false;

  async snapshot(): Promise<ThreadSnapshot> {
    await this.ensureReady();
    const events = this.events();
    const panels = this.panels();
    const memories = this.memories();
    return { events, panels, memories, context: { recentEventCount: events.slice(-24).length, memoryCount: memories.filter((m) => m.state === "kept").length, checkpointSummary: this.latestSummary() } };
  }

  async send(text: string, requestId?: string): Promise<ExecuteResult> {
    await this.ensureReady();
    const cleaned = text.trim();
    if (!cleaned) throw new Error("Message is required.");
    const turnId = normalizeRequestId(requestId) ?? crypto.randomUUID();
    if (this.turn(turnId)) return { snapshot: await this.snapshot(), appendedEventIds: [] };
    const user = this.append("user_message", { text: cleaned, turnId });
    this.saveTurn({ id: turnId, userEventId: user.id, status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const ids: string[] = [user.id];
    try {
      const current = await this.snapshot();
      const prompt = buildRollingPrompt({ summary: current.context.checkpointSummary, memories: relevantMemories(current.memories, cleaned), panels: current.panels, recentEvents: current.events.slice(-24) }, cleaned);
      const parsed = parseAgentAnswer(await this.generateAnswer(prompt));
      const notes: string[] = [];
      for (const action of parsed.actions) {
        const result = await this.perform(action, user.revision);
        notes.push(result.note);
        if (result.eventId) ids.push(result.eventId);
      }
      const assistant = this.append("assistant_message", { text: [parsed.reply, ...notes].filter(Boolean).join("\n"), turnId });
      ids.push(assistant.id);
      if (shouldCheckpoint(this.events())) {
        const summary = await createCheckpoint(this.env.AI, this.env.LOOP_MODEL ?? "@cf/moonshotai/kimi-k2.6", this.events());
        ids.push(this.append("summary_checkpoint", { summary, throughRevision: assistant.revision }).id);
      }
      this.updateTurn(turnId, "complete");
      return { snapshot: await this.snapshot(), appendedEventIds: ids };
    } catch (error) {
      this.updateTurn(turnId, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async remember(kind: MemoryKind, text: string): Promise<Memory> {
    await this.ensureReady();
    return this.commitMemory(kind, text, null).memory;
  }

  async signalMemory(id: string, state: "wrong" | "forgotten"): Promise<Memory> {
    await this.ensureReady();
    const existing = this.memories().find((m) => m.id === id);
    if (!existing) throw new Error("Memory not found.");
    this.ctx.storage.sql.exec("UPDATE memories SET state = ? WHERE id = ?", state, id);
    this.append("memory_signaled", { memoryId: id, state });
    return { ...existing, state };
  }

  async createPanel(input: { id: string; title: string; source: string; pin?: boolean }): Promise<Panel> {
    await this.ensureReady();
    await this.savePanel(input, null, this.panels().some((p) => p.id === input.id) ? "panel_revised" : "panel_created");
    return this.panels().find((p) => p.id === input.id)!;
  }

  async exportLedger() {
    await this.ensureReady();
    return { format: "loop-ledger-v1", exportedAt: new Date().toISOString(), snapshot: await this.snapshot(), panelRevisions: this.ctx.storage.sql.exec<{ id: string; panel_id: string; title: string; source: string; source_hash: string; created_at: string; prompted_by_revision: number | null }>("SELECT id, panel_id, title, source, source_hash, created_at, prompted_by_revision FROM panel_revisions ORDER BY created_at ASC").toArray() };
  }

  private async ensureReady() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (revision INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, committed_at TEXT NOT NULL, payload_json TEXT NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, committed_at TEXT NOT NULL, source_revision INTEGER, state TEXT NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, title TEXT NOT NULL, pinned INTEGER NOT NULL, active_revision_id TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS panel_revisions (id TEXT PRIMARY KEY, panel_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, source_hash TEXT NOT NULL, client_js TEXT NOT NULL, css TEXT NOT NULL, created_at TEXT NOT NULL, prompted_by_revision INTEGER)`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, user_event_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`);
    this.ready = true;
  }

  private events(): LoopEvent[] { return this.ctx.storage.sql.exec<{ revision: number; id: string; type: LoopEvent["type"]; committed_at: string; payload_json: string }>("SELECT revision, id, type, committed_at, payload_json FROM events ORDER BY revision ASC").toArray().map((r) => ({ revision: r.revision, id: r.id, type: r.type, committedAt: r.committed_at, payload: JSON.parse(r.payload_json) })); }
  private panels(): Panel[] { return this.ctx.storage.sql.exec<{ id: string; title: string; pinned: number; active_revision_id: string; updated_at: string; revision_id: string; source: string; source_hash: string; client_js: string; css: string; created_at: string; prompted_by_revision: number | null }>(`SELECT p.id, p.title, p.pinned, p.active_revision_id, p.updated_at, r.id as revision_id, r.source, r.source_hash, r.client_js, r.css, r.created_at, r.prompted_by_revision FROM panels p JOIN panel_revisions r ON r.id = p.active_revision_id ORDER BY p.updated_at DESC`).toArray().map((r) => ({ id: r.id, title: r.title, pinned: r.pinned === 1, activeRevisionId: r.active_revision_id, updatedAt: r.updated_at, revision: { id: r.revision_id, panelId: r.id, title: r.title, source: r.source, sourceHash: r.source_hash, clientJs: r.client_js, css: r.css, svelteVersion: "5", createdAt: r.created_at, promptedByRevision: r.prompted_by_revision } })); }
  private memories(): Memory[] { return this.ctx.storage.sql.exec<{ id: string; kind: MemoryKind; text: string; committed_at: string; source_revision: number | null; state: Memory["state"] }>("SELECT id, kind, text, committed_at, source_revision, state FROM memories ORDER BY committed_at DESC").toArray().map((r) => ({ id: r.id, kind: r.kind, text: r.text, committedAt: r.committed_at, sourceRevision: r.source_revision, state: r.state })); }
  private latestSummary() { const event = [...this.events()].reverse().find((e) => e.type === "summary_checkpoint"); return event ? String(event.payload.summary ?? "") : null; }
  private append(type: LoopEvent["type"], payload: Record<string, unknown>) { const id = crypto.randomUUID(); const committedAt = new Date().toISOString(); this.ctx.storage.sql.exec("INSERT INTO events (id, type, committed_at, payload_json) VALUES (?, ?, ?, ?)", id, type, committedAt, JSON.stringify(payload)); const revision = this.ctx.storage.sql.exec<{ revision: number }>("SELECT revision FROM events WHERE id = ?", id).toArray()[0].revision; return { revision, id, type, committedAt, payload }; }
  private commitMemory(kind: MemoryKind, text: string, sourceRevision: number | null) { const cleaned = text.trim(); const prior = this.memories().find((m) => m.kind === kind && m.text === cleaned && m.state === "kept"); if (prior) return { memory: prior, eventId: "" }; const id = crypto.randomUUID(); const committedAt = new Date().toISOString(); this.ctx.storage.sql.exec("INSERT INTO memories (id, kind, text, committed_at, source_revision, state) VALUES (?, ?, ?, ?, ?, 'kept')", id, kind, cleaned, committedAt, sourceRevision); const event = this.append("memory_committed", { memoryId: id, kind, text: cleaned, sourceRevision }); return { memory: { id, kind, text: cleaned, committedAt, sourceRevision, state: "kept" as const }, eventId: event.id }; }
  private async savePanel(input: { id: string; title: string; source: string; pin?: boolean }, promptedByRevision: number | null, eventType: "panel_created" | "panel_revised") { const compiled = await compilePanel({ ...input, promptedByRevision }); const current = this.panels().find((p) => p.id === input.id); if (current?.revision.sourceHash === compiled.sourceHash && current.pinned === (input.pin !== false)) return ""; this.ctx.storage.sql.exec("INSERT INTO panel_revisions (id, panel_id, title, source, source_hash, client_js, css, created_at, prompted_by_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", compiled.id, compiled.panelId, compiled.title, compiled.source, compiled.sourceHash, compiled.clientJs, compiled.css, compiled.createdAt, compiled.promptedByRevision); this.ctx.storage.sql.exec("INSERT INTO panels (id, title, pinned, active_revision_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, pinned=excluded.pinned, active_revision_id=excluded.active_revision_id, updated_at=excluded.updated_at", input.id, input.title, input.pin === false ? 0 : 1, compiled.id, compiled.createdAt); return this.append(eventType, { panelId: input.id, title: input.title, sourceHash: compiled.sourceHash, revisionId: compiled.id }).id; }
  private async perform(action: ToolAction, revision: number) { if (action.name === "remember") { const r = this.commitMemory(action.input.kind, action.input.text, revision); return { note: r.eventId ? `remembered: ${r.memory.text}` : `memory unchanged: ${r.memory.text}`, eventId: r.eventId }; } const kind = this.panels().some((p) => p.id === action.input.id) ? "panel_revised" : "panel_created"; const eventId = await this.savePanel(action.input, revision, kind); return { note: eventId ? `${kind}: ${action.input.id}` : `panel unchanged: ${action.input.id}`, eventId }; }
  private async generateAnswer(prompt: string) { const output = await this.env.AI.run((this.env.LOOP_MODEL ?? "@cf/moonshotai/kimi-k2.6") as keyof AiModels, { messages: [{ role: "user", content: prompt }], max_completion_tokens: 8192, chat_template_kwargs: { enable_thinking: false } }) as { response?: string; result?: { response?: string }; choices?: Array<{ message?: { content?: string | null } }> }; const text = output.response ?? output.result?.response ?? output.choices?.[0]?.message?.content; if (!text || typeof text !== "string") throw new Error("Model returned no response."); return text.trim(); }
  private turn(id: string) { return this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM turns WHERE id = ?", id).toArray()[0]; }
  private saveTurn(t: TurnState) { this.ctx.storage.sql.exec("INSERT INTO turns (id, user_event_id, status, created_at, updated_at, error) VALUES (?, ?, ?, ?, ?, ?)", t.id, t.userEventId, t.status, t.createdAt, t.updatedAt, t.error ?? null); }
  private updateTurn(id: string, status: TurnState["status"], error?: string) { this.ctx.storage.sql.exec("UPDATE turns SET status = ?, updated_at = ?, error = ? WHERE id = ?", status, new Date().toISOString(), error ?? null, id); }
}

function normalizeRequestId(value?: string) { return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined; }
function relevantMemories(memories: Memory[], query: string) { const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2); return memories.map((memory) => ({ memory, score: terms.reduce((n, t) => n + Number(memory.text.toLowerCase().includes(t)), 0) })).sort((a, b) => b.score - a.score).slice(0, 10).map(({ memory }) => memory); }
function parseAgentAnswer(answer: string): { reply: string; actions: ToolAction[] } { try { const value = JSON.parse(answer.trim().replace(/^```json\s*/i, "").replace(/```$/, "")) as { reply?: unknown; actions?: ToolAction[] }; return { reply: typeof value.reply === "string" ? value.reply : "done", actions: Array.isArray(value.actions) ? value.actions : [] }; } catch { return { reply: answer, actions: [] }; } }
