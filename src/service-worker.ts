/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

// Bump this when shipping a breaking SW change; SvelteKit's `version` is already
// the build hash so the cache name rolls on every deploy.
const CACHE = `loop-${version}`;

// Pre-cache: SvelteKit's compiled build chunks and static files that are safe to
// pin. We leave runtime API responses out of pre-cache so they always hit network.
const ASSETS = [...build, ...files];

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  // Never intercept API + auth + SvelteKit remote-function endpoints.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_app/remote/") ||
    url.pathname.startsWith("/api/auth/")
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Build artifacts are immutable: cache-first.
      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(request);
        if (cached) return cached;
      }
      // For HTML and everything else: network-first with cache fallback.
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        // Final fallback: minimal offline shell so the install still feels alive.
        return new Response(
          "<!doctype html><html><head><meta charset=utf-8><title>loop \u00b7 offline</title><style>body{background:#0a0a0a;color:#d4d4d8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;place-items:center;height:100vh;margin:0}</style></head><body><div>loop is offline. retry when you're back.</div></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    })(),
  );
});
