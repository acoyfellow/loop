import type { LoopEvent, Memory, Panel } from "./types";

export type RollingContext = {
  summary: string | null;
  memories: Memory[];
  panels: Panel[];
  recentEvents: LoopEvent[];
};

export function buildRollingPrompt(context: RollingContext, incoming: string): string {
  const transcript = context.recentEvents
    .filter((event) => event.type === "user_message" || event.type === "assistant_message")
    .map((event) => `${event.type === "user_message" ? "Jordan" : "Loop"}: ${String(event.payload.text ?? "")}`)
    .join("\n");
  const memory = context.memories
    .filter((entry) => entry.state === "kept")
    .map((entry) => `- [${entry.kind}] ${entry.text}`)
    .join("\n") || "- none yet";
  const panels = context.panels
    .map((panel) => `- ${panel.id}: ${panel.title} (source hash ${panel.revision.sourceHash.slice(0, 12)})`)
    .join("\n") || "- none yet";

  return `You are Loop, Jordan's continuous personal agent application.

There is one permanent conversation. The event ledger remains exact even when older turns are not included below. You can build and revise live Svelte 5 panels through typed actions. Keep responses warm, terse, and concrete.

When the user asks you to make, add, create, change, revise, color, or pin an interface/panel/widget, respond with JSON only in this shape:
{"reply":"short explanation","actions":[{"name":"create_panel","input":{"id":"kebab-id","title":"Title","source":"complete Svelte 5 source","pin":true}},{"name":"remember","input":{"kind":"preference","text":"durable memory only when the user requests it or states a stable convention"}}]}

Choose create_panel for a new id and revise_panel for an existing id shown below. When the user requests memory, always include a remember action with their stated durable preference or decision. When there is no interface or memory action, respond as normal text. Never include markdown fences inside JSON. Svelte rules: use runes ($state/$derived/$props), use onclick not on:click, keep source self-contained, and use parent.postMessage({ type: 'loop:action', action: '...', value: ... }, '*') only for user interaction.

Long-running summary:
${context.summary ?? "No checkpoint yet. Exact recent turns follow."}

Durable memory:
${memory}

Pinned living panels:
${panels}

Recent conversation:
${transcript || "(first turn)"}

Jordan: ${incoming}`;
}

export function shouldCheckpoint(events: LoopEvent[]): boolean {
  const previous = [...events].reverse().find((event) => event.type === "summary_checkpoint");
  const through = previous ? Number(previous.payload.throughRevision ?? 0) : 0;
  return events.filter((event) => event.revision > through && event.type !== "summary_checkpoint").length > 32;
}

export async function createCheckpoint(ai: Ai, model: string, events: LoopEvent[]): Promise<string> {
  const previous = [...events].reverse().find((event) => event.type === "summary_checkpoint");
  const through = previous ? Number(previous.payload.throughRevision ?? 0) : 0;
  const material = events
    .filter((event) => event.revision > through && event.type !== "summary_checkpoint")
    .map((event) => `#${event.revision} ${event.type}: ${JSON.stringify(event.payload)}`)
    .join("\n");
  const prompt = `Summarize this append-only agent thread segment for future model context. Preserve decisions, preferences, open work, failures, and named panels. Be factual and compact. Do not claim the exact ledger is gone.\n\n${material}`;
  const output = await ai.run(model as keyof AiModels, { messages: [{ role: "user", content: prompt }], max_completion_tokens: 1200, chat_template_kwargs: { enable_thinking: false } }) as { response?: string; choices?: Array<{ message?: { content?: string | null } }> };
  const text = output.response ?? output.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") throw new Error("Model returned no checkpoint summary.");
  return text.trim();
}
