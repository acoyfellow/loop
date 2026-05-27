import { getAgentByName } from "agents";
import { Loop, type LoopEnv } from "./LoopDO";
import { compilePanel } from "./panels";
import type { MemoryKind, ThreadSnapshot } from "./types";

export interface Env extends LoopEnv {
  LOOP: DurableObjectNamespace<Loop>;
  ENVIRONMENT?: string;
  DEV_OWNER?: string;
}

export { Loop };

interface UIMessageChunk { type: string; delta?: string; text?: string; }
interface ChatStreamCallback {
  onEvent: (raw: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

type LoopStub = {
  chat: (message: string, callback: ChatStreamCallback) => Promise<void>;
  loopSnapshot: () => Promise<ThreadSnapshot>;
  signalMemory: (id: string, state: "wrong" | "forgotten") => Promise<unknown>;
  exportLedger: () => Promise<unknown>;
  resetThread: () => Promise<ThreadSnapshot>;
};

function cors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-loop-owner");
  return new Response(response.body, { status: response.status, headers });
}

function ownerKey(request: Request, env: Env): string {
  const supplied = request.headers.get("x-loop-owner")?.trim();
  const owner = supplied || (env.ENVIRONMENT === "dev" ? env.DEV_OWNER ?? "local-jordan" : "");
  if (!owner) throw new Error("Authenticated owner is required.");
  if (!/^[a-zA-Z0-9@._-]{1,120}$/.test(owner)) throw new Error("Invalid owner id.");
  return owner;
}

async function loopFor(env: Env, request: Request): Promise<LoopStub> {
  const owner = ownerKey(request, env);
  return (await getAgentByName(env.LOOP, owner, { routingRetry: { maxAttempts: 3 } })) as unknown as LoopStub;
}

const CHAT_TIMEOUT_MS = 75_000;

async function chatTurn(env: Env, request: Request, stub: LoopStub) {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const message = (body.text ?? "").trim();
  if (!message) return Response.json({ error: "text required" }, { status: 400 });
  let answer = "";
  let streamError: string | undefined;
  let timedOut = false;
  const chatPromise = stub.chat(message, {
    onEvent(raw) {
      try {
        const chunk = JSON.parse(raw) as UIMessageChunk;
        if (chunk.type === "text-delta") answer += chunk.delta ?? chunk.text ?? "";
      } catch { /* control frame */ }
    },
    onDone() {},
    onError(message) { streamError = message; },
  }).catch((cause: unknown) => {
    // Swallow late rejections so they don't surface as unhandled when the timeout wins.
    streamError = streamError ?? (cause instanceof Error ? cause.message : String(cause));
  });
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, CHAT_TIMEOUT_MS));
  await Promise.race([chatPromise, timeoutPromise]);
  if (timedOut) {
    const snapshot = await stub.loopSnapshot();
    return Response.json({
      ok: false,
      timedOut: true,
      answer: answer || "(no response before timeout)",
      snapshot,
      error: `Inference exceeded ${CHAT_TIMEOUT_MS / 1000}s. Try a smaller ask or reset the thread.`,
    }, { status: 504 });
  }
  if (streamError) {
    const snapshot = await stub.loopSnapshot();
    return Response.json({ ok: false, error: streamError, snapshot }, { status: 502 });
  }
  const snapshot = await stub.loopSnapshot();
  return Response.json({ ok: true, answer, snapshot });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") || "*";
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return cors(Response.json({ ok: true, name: "loop" }), origin);
      const stub = await loopFor(env, request);
      if (request.method === "GET" && url.pathname === "/api/thread") {
        return cors(Response.json(await stub.loopSnapshot()), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/messages") {
        return cors(await chatTurn(env, request, stub), origin);
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/memories/") && url.pathname.endsWith("/signal")) {
        const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const body = (await request.json().catch(() => ({}))) as { state?: "wrong" | "forgotten" };
        if (body.state !== "wrong" && body.state !== "forgotten") {
          return cors(Response.json({ error: "state must be wrong or forgotten" }, { status: 400 }), origin);
        }
        return cors(Response.json(await stub.signalMemory(id, body.state)), origin);
      }
      if (request.method === "GET" && url.pathname === "/api/export") {
        return cors(Response.json(await stub.exportLedger()), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        return cors(Response.json({ ok: true, snapshot: await stub.resetThread() }), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/compile-panel") {
        const body = (await request.json().catch(() => ({}))) as { id?: string; title?: string; source?: string };
        const revision = await compilePanel({ id: body.id ?? "preview", title: body.title ?? "Preview", source: body.source ?? "" });
        return cors(Response.json({ ok: true, ...revision }), origin);
      }
      return cors(Response.json({ error: "not found" }, { status: 404 }), origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[loop worker]", message, error instanceof Error ? error.stack : "");
      return cors(Response.json({ error: message }, { status: 500 }), origin);
    }
  },
} satisfies ExportedHandler<Env>;

export type _MemoryKind = MemoryKind;
