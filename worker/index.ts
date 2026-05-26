import { LoopDO, type LoopEnv } from "./LoopDO";
import type { MemoryKind } from "./types";
import { compilePanel } from "./panels";

export interface Env extends LoopEnv {
  LOOP: DurableObjectNamespace<LoopDO>;
  ENVIRONMENT?: string;
  DEV_OWNER?: string;
}

export { LoopDO };

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "http://127.0.0.1:5176");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-loop-owner");
  return new Response(response.body, { status: response.status, headers });
}

function owner(request: Request, env: Env): string {
  const supplied = request.headers.get("x-loop-owner")?.trim();
  const owner = supplied || (env.ENVIRONMENT === "dev" ? env.DEV_OWNER ?? "local-jordan" : "");
  if (!owner) throw new Error("Authenticated owner is required.");
  if (!/^[a-zA-Z0-9@._-]{1,120}$/.test(owner)) throw new Error("Invalid owner id.");
  return owner;
}

async function thread(env: Env, request: Request): Promise<LoopDO> {
  const id = env.LOOP.idFromName(owner(request, env));
  return env.LOOP.get(id) as unknown as LoopDO;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return cors(Response.json({ ok: true, name: "loop" }));
      const instance = await thread(env, request);
      if (request.method === "GET" && url.pathname === "/api/thread") {
        return cors(Response.json(await instance.snapshot()));
      }
      if (request.method === "POST" && url.pathname === "/api/messages") {
        const body = await request.json() as { text?: string; requestId?: string };
        return cors(Response.json(await instance.send(body.text ?? "", body.requestId)));
      }
      if (request.method === "POST" && url.pathname === "/api/memories") {
        const body = await request.json() as { kind?: MemoryKind; text?: string };
        if (!body.kind || !body.text) return cors(Response.json({ error: "kind and text required" }, { status: 400 }));
        return cors(Response.json(await instance.remember(body.kind, body.text)));
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/memories/") && url.pathname.endsWith("/signal")) {
        const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const body = await request.json() as { state?: "wrong" | "forgotten" };
        if (body.state !== "wrong" && body.state !== "forgotten") return cors(Response.json({ error: "state must be wrong or forgotten" }, { status: 400 }));
        return cors(Response.json(await instance.signalMemory(id, body.state)));
      }
      if (request.method === "POST" && url.pathname === "/api/panels") {
        const body = await request.json() as { id: string; title: string; source: string; pin?: boolean };
        return cors(Response.json(await instance.createPanel(body)));
      }
      if (request.method === "GET" && url.pathname === "/api/export") {
        return cors(Response.json(await instance.exportLedger(), { headers: { "content-disposition": "attachment; filename=loop-ledger.json" } }));
      }
      if (request.method === "POST" && url.pathname === "/api/compile-panel") {
        const body = await request.json() as { id?: string; title?: string; source?: string };
        const compiled = await compilePanel({ id: body.id ?? "preview", title: body.title ?? "Preview", source: body.source ?? "" });
        return cors(Response.json({ ok: true, panelId: compiled.panelId, sourceHash: compiled.sourceHash, clientJs: compiled.clientJs, css: compiled.css }));
      }
      return cors(Response.json({ error: "not found" }, { status: 404 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack ?? "" : "";
      console.error("[loop worker]", message, stack);
      return cors(Response.json({ error: message }, { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;
