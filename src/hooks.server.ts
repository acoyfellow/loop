import { building, dev } from "$app/environment";
import { initAuth } from "$lib/auth";
import { verifyInvite } from "$lib/invite";
import { svelteKitHandler } from "better-auth/svelte-kit";
import type { Handle } from "@sveltejs/kit";

const SIGNUP_PATH_PREFIX = "/api/auth/sign-up";

async function readJson(request: Request): Promise<{ raw: string; parsed: Record<string, unknown> | null }> {
  const raw = await request.text();
  if (!raw) return { raw, parsed: null };
  try {
    return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { raw, parsed: null };
  }
}

async function applyInviteGate(event: Parameters<Handle>[0]["event"]): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (event.request.method !== "POST") return { ok: true };
  if (!event.url.pathname.startsWith(SIGNUP_PATH_PREFIX)) return { ok: true };
  const { raw, parsed } = await readJson(event.request);
  const supplied = typeof parsed?.invitePassword === "string" ? parsed.invitePassword : null;
  if (!verifyInvite(event.platform?.env, supplied)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ code: "INVITE_REQUIRED", message: "Invite password required to create an account." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const cleaned = parsed && typeof parsed === "object" ? { ...parsed } : {};
  delete cleaned.invitePassword;
  const headers = new Headers(event.request.headers);
  const body = parsed ? JSON.stringify(cleaned) : raw;
  headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
  const forwarded = new Request(event.request.url, {
    method: event.request.method,
    headers,
    body,
  });
  // Re-bind the forwarded request onto the event by replacing the underlying.
  Object.defineProperty(event, "request", { value: forwarded, configurable: true });
  return { ok: true };
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.session = null;
  const db = event.platform?.env?.DB;
  const secret = event.platform?.env?.BETTER_AUTH_SECRET;

  if (dev && (!db || !secret)) return resolve(event);
  if (!db || !secret) return new Response("Authentication is not configured.", { status: 503 });

  const gate = await applyInviteGate(event);
  if (!gate.ok) return gate.response;

  const auth = initAuth(db, event.platform?.env, event.url.origin);
  const session = await auth.api.getSession({ headers: event.request.headers }).catch(() => null);
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;
  return svelteKitHandler({ event, resolve, auth, building });
};
