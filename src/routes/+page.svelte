<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { signIn, signOut, signUp } from "$lib/auth-client";
  import { Splitpanes, Pane } from "svelte-splitpanes";
  import type { Panel, ThreadSnapshot } from "$lib/thread";
  import { getThread, sendMessage, resetThread } from "./data.remote";

  let { data } = $props();
  let live = $state<ThreadSnapshot | null>(null);
  let pendingTurns = $state<Array<{ id: string; text: string }>>([]);
  const thread = $derived<ThreadSnapshot | null>(live ?? data.initialThread);

  let composer = $state("");
  let inflight = $state(0);
  let error = $state("");
  let authMode = $state<"in" | "up">("in");
  let email = $state("");
  let password = $state("");
  let invitePassword = $state("");
  let authBusy = $state(false);
  let sideTab = $state<"state" | "memory" | "recent">("state");
  let mainTab = $state<"thread" | "runtime" | "source">("thread");
  let selectedPanelId = $state<string | null>(null);

  type DisplayMessage = { kind: "user" | "assistant" | "pending"; text: string; key: string };
  const messages = $derived<DisplayMessage[]>([
    ...(thread?.messages ?? []).map((message) => ({
      kind: message.role,
      text: message.text,
      key: message.id,
    })),
    ...pendingTurns.flatMap((turn) => [
      { kind: "user" as const, text: turn.text, key: `pending-user-${turn.id}` },
      { kind: "pending" as const, text: "running…", key: `pending-assistant-${turn.id}` },
    ]),
  ]);
  const pinnedPanels = $derived((thread?.panels ?? []).filter((panel) => panel.pinned));
  const selectedPanel = $derived(thread?.panels.find((panel) => panel.id === selectedPanelId) ?? pinnedPanels[0] ?? null);
  const loadError = $derived(thread ? "" : data.loadError ?? "");

  async function refreshThread() {
    try {
      live = await getThread();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function submit() {
    const text = composer.trim();
    if (!text) return;
    const requestId = crypto.randomUUID();
    pendingTurns = [...pendingTurns, { id: requestId, text }];
    inflight += 1;
    error = "";
    composer = "";
    try {
      const snapshot = await sendMessage({ text });
      live = snapshot;
    } catch (cause) {
      const err = cause as Error & { snapshot?: ThreadSnapshot; status?: number };
      if (err?.snapshot) live = err.snapshot;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      inflight -= 1;
      pendingTurns = pendingTurns.filter((turn) => turn.id !== requestId);
    }
  }

  let resetting = $state(false);
  async function resetLoop() {
    if (!confirm("Reset the loop? Drops all messages, panels, and memories.")) return;
    resetting = true;
    error = "";
    try {
      live = await resetThread({});
      pendingTurns = [];
      selectedPanelId = null;
      mainTab = "thread";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      resetting = false;
    }
  }

  const stuckOrphan = $derived(
    thread !== null &&
    thread.messages.length > 0 &&
    thread.messages[thread.messages.length - 1].role === "user" &&
    inflight === 0 &&
    pendingTurns.length === 0,
  );

  function panelDocument(panel: Panel): string {
    const escapedCss = panel.revision.css.replace(/<\/style/gi, "<\\/style");
    const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(panel.revision.clientJs)}`;
    const hostCss = `html,body{margin:0;padding:0;background:#0a0a0a;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;min-height:100%}body{display:flex;align-items:center;justify-content:center}*{scrollbar-width:thin;scrollbar-color:transparent transparent}*:hover{scrollbar-color:#2a2a2e transparent}*::-webkit-scrollbar{width:6px;height:6px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:transparent;border-radius:3px}*:hover::-webkit-scrollbar-thumb{background:#2a2a2e}*::-webkit-scrollbar-thumb:hover{background:#3f3f46}*::-webkit-scrollbar-corner{background:transparent}`;
    const fitScript = `
      const post = () => {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        parent.postMessage({ type: "loop:fit", id: ${JSON.stringify(panel.id)}, height: h }, "*");
      };
      const ro = new ResizeObserver(post);
      ro.observe(document.documentElement);
      window.addEventListener("load", post);
      setTimeout(post, 50);
    `;
    return `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: { svelte: "https://esm.sh/svelte@5", "svelte/": "https://esm.sh/svelte@5/" } })}<\/script><style>${hostCss}</style><style>${escapedCss}</style></head><body><div id="app"></div><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});<\/script><script>${fitScript}<\/script></body></html>`;
  }

  function openSource(panel: Panel) {
    selectedPanelId = panel.id;
    mainTab = "source";
  }

  let panelHeights = $state<Record<string, number>>({});

  function handlePanelMessage(event: MessageEvent) {
    const data = event.data;
    if (data?.type === "loop:fit" && typeof data.id === "string" && typeof data.height === "number") {
      const clamped = Math.max(180, Math.min(360, Math.round(data.height)));
      if (panelHeights[data.id] !== clamped) panelHeights = { ...panelHeights, [data.id]: clamped };
      return;
    }
    if (data?.type !== "loop:action") return;
    composer = `Focus on ${String(data.value ?? "this selection")}.`;
  }

  let isWide = $state(true);
  $effect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 960px)");
    const sync = () => { isWide = mq.matches; };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  });

  function keydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  async function authenticate() {
    authBusy = true;
    error = "";
    try {
      if (authMode === "in") {
        const result = await signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message);
      } else {
        const result = await signUp.email({
          email,
          password,
          name: email.split("@")[0] || "user",
          invitePassword,
        } as never);
        if (result.error) throw new Error(result.error.message);
      }
      await invalidateAll();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      authBusy = false;
    }
  }
</script>

<svelte:window onmessage={handlePanelMessage} />
<svelte:head>
  <title>loop</title>
  <meta name="description" content="Persistent agent runtime." />
</svelte:head>

<div class="app">
  <header class="bar">
    <strong>loop</strong>
    {#if thread}
      <nav>
        <button class:active={mainTab === "thread"} onclick={() => mainTab = "thread"}>thread</button>
        <button class:active={mainTab === "runtime"} onclick={() => mainTab = "runtime"}>runtime</button>
        <button class:active={mainTab === "source"} onclick={() => mainTab = "source"}>source</button>
      </nav>
      <div class="bar-right">
        {#if page.data.user}
          <code>{page.data.user.email}</code>
          <button class="plain" disabled={resetting} onclick={resetLoop}>{resetting ? "resetting…" : "reset"}</button>
          <button class="plain" onclick={() => signOut()}>sign out</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if !thread}
    <section class="login">
      <h1>loop</h1>
      <p>{loadError ? loadError : authMode === "in" ? "Sign in to your loop." : "Create an account. Invite password required."}</p>
      <nav class="auth-modes">
        <button class:active={authMode === "in"} onclick={() => { authMode = "in"; error = ""; }}>sign in</button>
        <button class:active={authMode === "up"} onclick={() => { authMode = "up"; error = ""; }}>create account</button>
      </nav>
      <form onsubmit={(event) => { event.preventDefault(); authenticate(); }}>
        <input bind:value={email} placeholder="email" type="email" autocomplete="email" required />
        <input bind:value={password} placeholder="password" type="password" autocomplete={authMode === "in" ? "current-password" : "new-password"} required />
        {#if authMode === "up"}
          <input bind:value={invitePassword} placeholder="invite password" type="password" autocomplete="one-time-code" required />
        {/if}
        <div>
          <button disabled={authBusy} type="submit">{authMode === "in" ? "sign in" : "create account"}</button>
          {#if loadError}<button class="soft" type="button" onclick={refreshThread}>retry</button>{/if}
        </div>
      </form>
      {#if error}<pre>{error}</pre>{/if}
    </section>
  {:else}
    {#snippet transcriptPane()}
      <div class="section-head">
        <span>thread/main</span>
        <code>messages {thread.stats.messageCount}</code>
      </div>
      <div class="log">
        {#each messages as message (message.key)}
          <article class:user={message.kind === "user"}>
            <span class="role">{message.kind === "pending" ? "assistant" : message.kind}</span>
            <pre class:pending={message.kind === "pending"}>{message.text}</pre>
          </article>
        {/each}
      </div>
      <form onsubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea bind:value={composer} onkeydown={keydown} placeholder="message loop… e.g. revise the active-work surface and remember a convention" rows="4"></textarea>
        <footer><code>⌘↵ send</code><span class="queue">{inflight ? `${inflight} in flight` : ""}</span><button disabled={!composer.trim()}>send</button></footer>
      </form>
      {#if error}<pre class="error">{error}</pre>{/if}
      {#if stuckOrphan}
        <pre class="error">Last turn didn’t produce an assistant reply. Try again or <button class="plain inline" onclick={resetLoop}>reset the loop</button>.</pre>
      {/if}
    {/snippet}

    {#snippet runtimePane()}
      <div class="section-head"><span>{mainTab === "runtime" ? "runtime / mounted surfaces" : "surfaces"}</span><code>{pinnedPanels.length} mounted</code></div>
      <div class="mounts">
        {#each pinnedPanels as panel}
          <article class="mount">
            <header>
              <strong>{panel.id}</strong>
              <code>{panel.revision.sourceHash.slice(0, 10)}</code>
              <button class="plain" onclick={() => openSource(panel)}>source</button>
            </header>
            <iframe title={panel.title} srcdoc={panelDocument(panel)} sandbox="allow-scripts" style:height={panelHeights[panel.id] ? `${panelHeights[panel.id]}px` : undefined}></iframe>
          </article>
        {/each}
      </div>
    {/snippet}

    {#snippet sourcePane()}
      <div class="section-head"><span>source</span><code>{thread.panels.length} revisions active</code></div>
      <div class="source-layout">
        <nav class="files">
          {#each thread.panels as panel}
            <button class:chosen={selectedPanel?.id === panel.id} onclick={() => selectedPanelId = panel.id}>{panel.id}.svelte</button>
          {/each}
        </nav>
        {#if selectedPanel}
          <div class="editor">
            <header><strong>{selectedPanel.id}.svelte</strong><code>{selectedPanel.revision.sourceHash}</code></header>
            <pre>{selectedPanel.revision.source}</pre>
          </div>
        {:else}
          <p class="empty">No generated surfaces yet.</p>
        {/if}
      </div>
    {/snippet}

    {#snippet inspectPane()}
      <div class="tabs">
        <button class:chosen={sideTab === "state"} onclick={() => sideTab = "state"}>state</button>
        <button class:chosen={sideTab === "memory"} onclick={() => sideTab = "memory"}>memory</button>
        <button class:chosen={sideTab === "recent"} onclick={() => sideTab = "recent"}>recent</button>
      </div>
      {#if sideTab === "state"}
        <dl>
          <dt>thread</dt><dd>main</dd>
          <dt>owner</dt><dd>{page.data.user?.email ?? "—"}</dd>
          <dt>messages</dt><dd>{thread.stats.messageCount}</dd>
          <dt>surfaces</dt><dd>{thread.stats.panelCount}</dd>
          <dt>memories</dt><dd>{thread.stats.memoryCount}</dd>
        </dl>
      {:else if sideTab === "memory"}
        <div class="records">
          {#each thread.memories.filter((memory) => memory.state === "kept") as memory}
            <article><code>{memory.kind}</code><p>{memory.text}</p></article>
          {/each}
        </div>
      {:else}
        <div class="events">
          {#each [...thread.messages].reverse().slice(0, 30) as message}
            <div><code>{message.role}</code><span>{message.text}</span></div>
          {/each}
        </div>
      {/if}
    {/snippet}

    {#if isWide}
      <main class="split">
        <Splitpanes theme="loop-theme" dblClickSplitter={false}>
          <Pane size={38} minSize={22}>
            <section class="transcript">{@render transcriptPane()}</section>
          </Pane>
          {#if mainTab === "source"}
            <Pane size={44} minSize={28}>
              <section class="source-view">{@render sourcePane()}</section>
            </Pane>
          {:else}
            <Pane size={44} minSize={28}>
              <section class="runtime">{@render runtimePane()}</section>
            </Pane>
          {/if}
          <Pane size={18} minSize={14} maxSize={36}>
            <aside class="inspect">{@render inspectPane()}</aside>
          </Pane>
        </Splitpanes>
      </main>
    {:else}
      <main class="stack">
        {#if mainTab === "thread"}<section class="transcript">{@render transcriptPane()}</section>{/if}
        {#if mainTab === "runtime"}<section class="runtime">{@render runtimePane()}</section>{/if}
        {#if mainTab === "source"}<section class="source-view">{@render sourcePane()}</section>{/if}
        <aside class="inspect">{@render inspectPane()}</aside>
      </main>
    {/if}
  {/if}
</div>
