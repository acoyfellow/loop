# Contributing

Loop is intentionally small. Keep the top-level legible: one README, one obvious entry path, one file map.

## Validate

```sh
bun install
bun run verify
bun run e2e
```

## Constraints

- Preserve the file map in `README.md` — if you add a file, decide whether it earns a row.
- Treat the thread ledger as append-only; add revisions or signals, never overwrite history.
- Keep generated UI iframe-isolated and unprivileged.
- Do not add a deployment path that lacks an authenticated owner boundary.
- Prefer one clear end-to-end proof over a new partial surface.
