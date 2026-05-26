import { compile, VERSION } from "svelte/compiler";
import type { PanelRevision } from "./types";

const MAX_SOURCE_BYTES = 256 * 1024;

export type CompiledPanel = PanelRevision & {
  clientJs: string;
  css: string;
  svelteVersion: string;
};

export async function compilePanel(input: {
  id: string;
  title: string;
  source: string;
  promptedByRevision?: number | null;
}): Promise<CompiledPanel> {
  const bytes = new TextEncoder().encode(input.source).byteLength;
  if (!input.source.trim()) throw new Error("Panel source is empty.");
  if (bytes > MAX_SOURCE_BYTES) throw new Error(`Panel source exceeds ${MAX_SOURCE_BYTES} bytes.`);

  let compiled;
  try {
    compiled = compile(input.source, { generate: "client", dev: false, name: "LoopPanel" });
  } catch (error) {
    throw new Error(`Svelte compile failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const sourceHash = await sha256(input.source);
  return {
    id: crypto.randomUUID(),
    panelId: input.id,
    title: input.title,
    source: input.source,
    sourceHash,
    clientJs: compiled.js.code,
    css: compiled.css?.code ?? "",
    svelteVersion: VERSION,
    createdAt: new Date().toISOString(),
    promptedByRevision: input.promptedByRevision ?? null,
  };
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
