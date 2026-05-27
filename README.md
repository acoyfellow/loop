# loop

One permanent agent thread on Cloudflare. The model creates, revises, and remembers the interface as you work.

Live: <https://loop.coey.dev> · sign-up requires an invite password.

```
you ──▶ owner thread (Durable Object)
            ├─ ledger        every message, action, checkpoint
            ├─ memory        kept preferences and decisions
            └─ surfaces      Svelte panels compiled on the Worker
```

Each turn calls Workers AI. When the model emits a `create_panel` / `revise_panel` / `remember` action, the Worker compiles the generated Svelte 5 source and mounts it in the runtime pane. Nothing is mocked.

## Run

Requires Bun, Node 22+, and a Cloudflare-authenticated `wrangler` with Workers AI access.

```sh
bun install
bun run dev          # starts both the SvelteKit app and the Worker
```

Open <http://127.0.0.1:5176>. The live deployment lives at <https://loop.coey.dev>.

Try:

> Create a panel called build-status that lists Loop, my-ax, and svelte-edge. Remember that cyan means a running experiment.

You will see, in this order:

1. the message in the `thread` pane;
2. a `running…` placeholder while Workers AI works (you can send another message immediately);
3. a compiled Svelte panel mounted in `runtime`;
4. a kept memory in the `memory` inspector;
5. the exact generated `.svelte` source under `source`.

Reload — everything survives. `events` shows the immutable record.

## Verify

```sh
bun run check    # SvelteKit + Worker type-check
bun run test     # context / compiler unit tests
bun run verify   # check + test + build (runs automatically on git push)
bun run e2e      # real Workers AI: panel, memory, durable reload
bun run stress   # real inference + rolling checkpoint + export
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
src/routes/+page.svelte     UI: thread, runtime, source, inspector
src/routes/+page.server.ts  load thread snapshot
src/routes/data.remote.ts   getThread, sendMessage, saveMemory
worker/index.ts             HTTP boundary + owner routing
worker/LoopDO.ts            Loop extends Think — transcript, tools, memory, panels, export
worker/panels.ts            Svelte 5 compile
worker/types.ts             vocabulary
wrangler.local.jsonc        local DO + remote Workers AI binding
alchemy.run.ts              Cloudflare deployment graph
tests/                      unit + Playwright + API stress
```

That is the whole core.

## Contract

| Surface      | Behavior                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Thread       | One SQLite-backed Durable Object per authenticated owner                                       |
| Inference    | Workers AI binding (default `@cf/moonshotai/kimi-k2.6`)                                        |
| Record       | Messages and runtime actions append immutable events                                           |
| Context      | Recent 24 events plus retrieved memory, panel state, and last model-written checkpoint summary |
| Memory       | Typed kept records (`preference`, `decision`, `fact`, `failure`, `open_loop`); `wrong` / `forgotten` are signals, not deletions |
| Surfaces     | Model emits complete Svelte 5 source; Worker compiles it; iframe mounts the result             |
| Idempotency  | `requestId` on `/api/messages` prevents duplicate turns                                        |
| Export       | `GET /api/export` returns the ledger and every panel source revision                           |

## Boundaries

- Generated Svelte runs in a sandboxed iframe with no owner credentials or Worker bindings.
- Backend mutations are fixed typed actions, not generated code.
- Auth: Better Auth + D1. Local development uses a fixed owner so login is not required.
- Production sign-up is gated by an invite password (`LOOP_INVITE_PASSWORD`). Sign-in for existing accounts is unaffected. When the env var is unset, sign-up is open — only use that locally.

## Provenance

`loop` originally prepared repositories for repeated agent runs. This is the same idea at app scale: the vessel is now one durable owner thread the model can read, write, and rebuild the interface inside.

Patterns reused:

- [`remote`](https://github.com/acoyfellow/remote) — authenticated SvelteKit + Durable Objects shell.
- [`svelte-edge`](https://github.com/acoyfellow/svelte-edge) — Svelte 5 source compiled at the edge.
- [`deja`](https://github.com/acoyfellow/deja) — durable selected memory discipline.

MIT.
