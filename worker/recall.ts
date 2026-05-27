// Long-term memory backed by Cloudflare Vectorize.
//
// When the rolling window evicts an older message pair, we embed it with
// Workers AI (bge-base-en-v1.5, 768 dims) and upsert into the Vectorize
// index, keyed by the original message id. On the next turn the model can
// call `search_context("topic")` and Think will route to RecallProvider.
//
// One index per deployment; rows are namespaced by ownerId so multiple
// users share an index without leaking into each other.

export type VectorizeBinding = {
  upsert: (vectors: VectorizeUpsertRow[]) => Promise<unknown>;
  query: (vector: number[], opts?: {
    topK?: number;
    filter?: Record<string, unknown>;
    returnMetadata?: "all" | "indexed" | "none" | true | false;
  }) => Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;
  deleteByIds: (ids: string[]) => Promise<unknown>;
};

export type VectorizeUpsertRow = {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Record<string, unknown>;
};

export type RecallEnv = {
  AI: Ai;
  MEMORY?: VectorizeBinding;
  LOOP_EMBED_MODEL?: string;
};

export class Recall {
  constructor(private readonly env: RecallEnv, private readonly ownerId: string) {}

  private get embedModel(): string {
    return this.env.LOOP_EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
  }

  private get index(): VectorizeBinding | null {
    return this.env.MEMORY ?? null;
  }

  /** Embed text via Workers AI. Returns the 768-dim vector, or null on failure. */
  async embed(text: string): Promise<number[] | null> {
    if (!this.env.AI) return null;
    const cleaned = text.trim().slice(0, 4_000);
    if (!cleaned) return null;
    try {
      const out = (await this.env.AI.run(this.embedModel as never, { text: [cleaned] } as never)) as { data?: number[][] };
      return out.data?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Stash a single message (user or assistant) into Vectorize. Best-effort. */
  async stash(args: { id: string; role: "user" | "assistant"; text: string; ts: number }): Promise<boolean> {
    if (!this.index) return false;
    if (!args.text.trim()) return false;
    const vec = await this.embed(args.text);
    if (!vec) return false;
    try {
      await this.index.upsert([{
        id: `${this.ownerId}:${args.id}`,
        values: vec,
        namespace: this.ownerId,
        metadata: { role: args.role, text: args.text.slice(0, 2_000), ts: args.ts, owner: this.ownerId },
      }]);
      return true;
    } catch {
      return false;
    }
  }

  /** Top-k semantic recall for the given query string, scoped to this owner. */
  async search(query: string, topK = 5): Promise<Array<{ score: number; role: string; text: string; ts: number }>> {
    if (!this.index) return [];
    const cleaned = query.trim();
    if (!cleaned) return [];
    const vec = await this.embed(cleaned);
    if (!vec) return [];
    try {
      const out = await this.index.query(vec, {
        topK,
        filter: { owner: this.ownerId },
        returnMetadata: "all",
      });
      return out.matches
        .filter((m) => typeof m.metadata?.text === "string")
        .map((m) => ({
          score: m.score,
          role: String(m.metadata?.role ?? "user"),
          text: String(m.metadata?.text ?? ""),
          ts: Number(m.metadata?.ts ?? 0),
        }));
    } catch {
      return [];
    }
  }

  /** Drop everything we've stashed for this owner. Used by /api/reset. */
  async forget(ids: string[]): Promise<void> {
    if (!this.index || ids.length === 0) return;
    try {
      await this.index.deleteByIds(ids.map((id) => `${this.ownerId}:${id}`));
    } catch { /* best-effort */ }
  }
}
