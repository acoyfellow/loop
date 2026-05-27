// Lazy Shiki highlighter for the source pane. Created once per session.
import type { HighlighterCore } from "shiki";

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function loadHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import("shiki/core");
    const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
    const svelte = (await import("shiki/langs/svelte.mjs")).default;
    const theme = (await import("shiki/themes/vitesse-dark.mjs")).default;
    return createHighlighterCore({
      themes: [theme],
      langs: [svelte],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterPromise;
}

export async function highlightSvelte(source: string): Promise<string> {
  const highlighter = await loadHighlighter();
  return highlighter.codeToHtml(source, { lang: "svelte", theme: "vitesse-dark" });
}
