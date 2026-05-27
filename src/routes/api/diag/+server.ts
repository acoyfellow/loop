import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  return new Response(JSON.stringify({
    url: event.url.toString(),
    pathname: event.url.pathname,
    method: event.request.method,
    invite_len: typeof event.platform?.env?.LOOP_INVITE_PASSWORD === "string"
      ? event.platform!.env!.LOOP_INVITE_PASSWORD!.length
      : null,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
};
