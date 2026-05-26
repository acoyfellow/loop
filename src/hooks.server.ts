import { building, dev } from "$app/environment";
import { initAuth } from "$lib/auth";
import { svelteKitHandler } from "better-auth/svelte-kit";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.session = null;
  const db = event.platform?.env?.DB;
  const secret = event.platform?.env?.BETTER_AUTH_SECRET;

  // Local development bypasses the auth ceremony only; the agent/runtime path remains real.
  if (dev && (!db || !secret)) return resolve(event);
  if (!db || !secret) return new Response("Authentication is not configured.", { status: 503 });

  const auth = initAuth(db, event.platform?.env, event.url.origin);
  const session = await auth.api.getSession({ headers: event.request.headers }).catch(() => null);
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;
  return svelteKitHandler({ event, resolve, auth, building });
};
