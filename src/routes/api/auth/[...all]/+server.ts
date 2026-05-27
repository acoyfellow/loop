// Better Auth handles /api/auth/* inside src/hooks.server.ts via svelteKitHandler.
// This file exists only to satisfy SvelteKit's catch-all route pattern when type-generating.
import type { RequestHandler } from "./$types";

export const fallback: RequestHandler = async () => {
  return new Response(JSON.stringify({ error: "Auth route not handled" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
};
