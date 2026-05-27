import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const env = event.platform?.env ?? {};
  const keys = Object.keys(env);
  const summary = keys.map((k) => ({
    key: k,
    type: typeof (env as Record<string, unknown>)[k],
    isString: typeof (env as Record<string, unknown>)[k] === "string",
    length: typeof (env as Record<string, unknown>)[k] === "string" ? ((env as Record<string, string>)[k] ?? "").length : null,
  }));
  return new Response(JSON.stringify({ ok: true, keys, summary }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
