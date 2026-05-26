import type { RequestHandler } from "./$types";
import { initAuth } from "$lib/auth";
import { verifyInvite } from "$lib/invite";

async function readJsonBody(request: Request): Promise<{ raw: string; parsed: Record<string, unknown> | null }> {
  const raw = await request.text();
  if (!raw) return { raw, parsed: null };
  try {
    return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { raw, parsed: null };
  }
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ code: "INVITE_REQUIRED", message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function unavailable(): Response {
  return new Response(JSON.stringify({ error: "Authentication service temporarily unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function gateSignup(event: Parameters<RequestHandler>[0]): Promise<{ ok: true; request: Request } | { ok: false; response: Response }> {
  if (!event.url.pathname.endsWith("/sign-up/email")) return { ok: true, request: event.request };
  const { raw, parsed } = await readJsonBody(event.request);
  const supplied = typeof parsed?.invitePassword === "string" ? parsed.invitePassword : null;
  if (!verifyInvite(event.platform?.env, supplied)) {
    return { ok: false, response: unauthorized("Invite password required to create an account.") };
  }
  const cleaned = parsed && typeof parsed === "object" ? { ...parsed } : {};
  delete cleaned.invitePassword;
  const forwarded = new Request(event.request.url, {
    method: event.request.method,
    headers: event.request.headers,
    body: parsed ? JSON.stringify(cleaned) : raw,
  });
  return { ok: true, request: forwarded };
}

export const GET: RequestHandler = async (event) => {
  const db = event.platform?.env?.DB;
  if (!db) return unavailable();
  try {
    const auth = initAuth(db, event.platform?.env, event.url.origin);
    return await auth.handler(event.request);
  } catch (error) {
    console.error("auth GET", error);
    return unavailable();
  }
};

export const POST: RequestHandler = async (event) => {
  const db = event.platform?.env?.DB;
  if (!db) return unavailable();
  try {
    const gate = await gateSignup(event);
    if (!gate.ok) return gate.response;
    const auth = initAuth(db, event.platform?.env, event.url.origin);
    return await auth.handler(gate.request);
  } catch (error) {
    console.error("auth POST", error);
    return unavailable();
  }
};
