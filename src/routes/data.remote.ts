import { command, getRequestEvent, query } from "$app/server";
import { dev } from "$app/environment";
import type { ThreadSnapshot } from "$lib/thread";

const LOCAL_OWNER = "local-jordan";

function currentOwner(): string {
  const event = getRequestEvent();
  if (dev) {
    const cookie = event.cookies.get("loop-owner") ?? event.request.headers.get("x-loop-owner") ?? null;
    return event.locals.user?.id ?? cookie ?? LOCAL_OWNER;
  }
  if (!event.locals.user) throw new Error("Sign in to access your loop.");
  return event.locals.user.id;
}

async function callWorker<T>(path: string, init?: RequestInit): Promise<T> {
  const event = getRequestEvent();
  const owner = currentOwner();
  const requestInit: RequestInit = {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-loop-owner": owner,
      ...(init?.headers ?? {}),
    },
  };
  const response = dev
    ? await fetch(`http://127.0.0.1:1337${path}`, requestInit)
    : await event.platform!.env.WORKER.fetch(new Request(`http://loop${path}`, requestInit));
  const body = await response.json() as T & { error?: string; snapshot?: unknown };
  if (!response.ok) {
    // 504/502 responses still include a snapshot for the UI; attach to thrown error so the caller can recover.
    const err = new Error(body.error ?? `Loop request failed (${response.status})`) as Error & { snapshot?: unknown; status?: number };
    err.snapshot = body.snapshot;
    err.status = response.status;
    throw err;
  }
  return body;
}

export const getThread = query(async (): Promise<ThreadSnapshot> => {
  return callWorker<ThreadSnapshot>("/api/thread");
});

export const sendMessage = command(
  "unchecked",
  async (input: { text: string }): Promise<ThreadSnapshot> => {
    const result = await callWorker<{ snapshot: ThreadSnapshot }>("/api/messages", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.snapshot;
  },
);

export const resetThread = command(
  "unchecked",
  async (): Promise<ThreadSnapshot> => {
    const result = await callWorker<{ snapshot: ThreadSnapshot }>("/api/reset", { method: "POST" });
    return result.snapshot;
  },
);

