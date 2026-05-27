# loop

A personal chatbot that **ships working artifacts**. Every reply can compile a real Svelte 5 widget next to the conversation. The assistant also takes notes ("remember that I prefer dark themes") and they stick. One long-running session per account — older turns roll into searchable long-term memory; press **reset** to start over.

Live: <https://loop.coey.dev> · sign-up requires an invite password.

```
you ──▶ chat session (Durable Object)
            ├─ messages    last 16 turns kept verbatim
            ├─ recall      everything older, embedded in Vectorize
            ├─ facts       typed notes the assistant decided to save
            └─ artifacts   Svelte 5 widgets compiled on the edge
```

Each turn runs through Workers AI. When the model calls the `panel` tool, the Worker compiles the generated Svelte 5 and mounts it next to the chat. When it calls `remember`, a typed fact is saved. As the conversation grows, older messages are embedded with bge-base-en and pushed into Cloudflare Vectorize; the model can recall them via `search_context`. Nothing is mocked.

## Run

Requires Bun, Node 22+, and a Cloudflare-authenticated `wrangler` with Workers AI + Vectorize access.

```sh
bun install
bun run dev          # starts both the SvelteKit app and the Worker
```

Open <http://127.0.0.1:5176>. The live deployment lives at <https://loop.coey.dev>.

Try:

> Create a panel called build-status that lists three repos in cyan. Remember that cyan means a running experiment.

You will see, in this order:

1. the message appear in **chat**;
2. a `running…` placeholder while Workers AI works (you can send another message immediately);
3. a compiled Svelte widget mounted in **artifacts**;
4. a saved fact appear in **facts**;
5. the exact generated `.svelte` under **source** with syntax highlighting.

Reload — everything survives. After ~16 turns, older messages start getting embedded into Vectorize; the model can search them on demand.

## Verify

```sh
bun run check    # SvelteKit + Worker type-check
bun run test     # unit tests
bun run verify   # check + test + build (runs automatically on git push)
bun run e2e      # real Workers AI: artifact, fact, durable reload
bun run stress   # real inference + rolling window + Vectorize recall + export
```

`e2e` and `stress` call Workers AI and consume usage.

## Ship

CI is manual-only. `verify` runs locally on every `git push` via `.githooks/pre-push` (installed automatically by `bun install`). To deploy to <https://loop.coey.dev>:

```sh
bun run ship    # verify + push + trigger deploy workflow + watch
```

Skip the local gate with `git push --no-verify` or `LOOP_SKIP_VERIFY=1`. Trigger workflows by hand any time with `gh workflow run {deploy,verify,inference} --repo acoyfellow/loop`.

## Layout

```
src/routes/+page.svelte     UI: chat, artifacts, source, inspector
src/routes/+page.server.ts  load chat snapshot
src/routes/data.remote.ts   getThread, sendMessage, resetThread
src/lib/highlight.ts        Shiki (vitesse-dark, lang=svelte) lazy loaded
worker/index.ts             HTTP boundary + owner routing
worker/LoopDO.ts            Loop extends Think — messages, tools, facts, artifacts, recall
worker/recall.ts            Vectorize-backed long-term memory (bge-base-en, top-k)
worker/panels.ts            Svelte 5 compile
worker/types.ts             vocabulary
wrangler.local.jsonc        local DO + remote Workers AI + Vectorize
alchemy.run.ts              Cloudflare deployment graph
tests/                      unit + Playwright + API stress
```

That is the whole core.

## How memory works

There is exactly **one chat session per account**. No conversation list, no folders, no compaction, no auto-summarization.

- The most recent **16 messages** stay verbatim in the prompt every turn.
- When the count exceeds 16, the oldest pair is embedded (Workers AI `@cf/baai/bge-base-en-v1.5`, 768-dim) and upserted into a Cloudflare Vectorize index, namespaced by owner.
- The model gets a `search_context` tool. When the user asks about something out-of-window, it queries Vectorize, top-k 5, and pulls the matches back into the prompt.
- The **facts** table is the model's deliberate memory: typed entries (`preference`, `decision`, `fact`, `failure`, `open_loop`) created when the user explicitly says "remember…". These never get rolled out.
- **`reset`** wipes everything — messages, artifacts, facts, and Vectorize entries — and starts the same single session over.

## Contract

| Surface      | Behavior                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Chat         | One SQLite-backed Durable Object per authenticated owner                                       |
| Inference    | Workers AI binding (default `@cf/moonshotai/kimi-k2.6`)                                        |
| Window       | Last 16 messages kept verbatim; older ones evicted to Vectorize each turn                      |
| Recall       | Workers AI embeddings (`@cf/baai/bge-base-en-v1.5`) into a Vectorize index, scoped by owner    |
| Facts        | Typed records (`preference`, `decision`, `fact`, `failure`, `open_loop`); `wrong` / `forgotten` are signals, not deletions |
| Artifacts    | Model emits complete Svelte 5 source; Worker compiles it; iframe mounts the result             |
| Idempotency  | `requestId` on `/api/messages` prevents duplicate turns                                        |
| Export       | `GET /api/export` returns the full chat history and every artifact revision                    |

## Boundaries

- Generated Svelte runs in a sandboxed iframe with no owner credentials or Worker bindings.
- Backend mutations are fixed typed actions, not generated code.
- Auth: Better Auth + D1. Local development uses a fixed owner so login is not required.
- Production sign-up is gated by an invite password (`LOOP_INVITE_PASSWORD`). Sign-in for existing accounts is unaffected. When the env var is unset, sign-up is open — only use that locally.

## Provenance

`loop` originally prepared repositories for repeated agent runs. This is the same idea at app scale: the vessel is now one durable owner session the model can read, write, and rebuild artifacts inside.

Patterns reused:

- [`remote`](https://github.com/acoyfellow/remote) — authenticated SvelteKit + Durable Objects shell.
- [`svelte-edge`](https://github.com/acoyfellow/svelte-edge) — Svelte 5 source compiled at the edge.
- [`deja`](https://github.com/acoyfellow/deja) — durable selected memory discipline.

MIT.
