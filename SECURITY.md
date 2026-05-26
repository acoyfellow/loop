# Security

Loop executes model-generated Svelte source. Treat each deployment as an authenticated personal application.

## Boundaries

- Model turns run through a Cloudflare Workers AI binding. No browser-supplied model credentials.
- Generated Svelte is compiled server-side and rendered inside a sandboxed iframe.
- Generated panels never receive the owner's auth state, connector credentials, or Worker bindings.
- Backend mutations are limited to typed actions (`create_panel`, `revise_panel`, `remember`); generated code cannot mutate the server.
- Thread data is partitioned by owner identity at the Durable Object boundary.

## Local development

The dev server bypasses login by routing the UI to a fixed owner. Inference and panel generation remain real. Do not expose the local dev server publicly.

## Before deployment

- Pick and validate the production owner boundary (self-hosted auth or Cloudflare Access).
- Set an explicit Workers AI usage / abuse policy.
- Adding generated backend authority, connectors, shell, or deploy privileges requires a separate review.

Report security concerns privately to jcoeyman@cloudflare.com.
