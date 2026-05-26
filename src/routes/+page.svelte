<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { signIn, signOut, signUp } from "$lib/auth-client";
  import type { Panel, ThreadSnapshot } from "$lib/thread";
  import { getThread, sendMessage } from "./data.remote";

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
  let sideTab = $state<"state" | "memory" | "events">("state");
  let mainTab = $state<"thread" | "runtime" | "source">("thread");
  let selectedPanelId = $state<string | null>(null);

  type DisplayMessage = { kind: "user" | "assistant" | "pending"; text: string; key: string };
  const messages = $derived<DisplayMessage[]>([
    ...(thread?.events ?? [])
      .filter((event) => event.type === "user_message" || event.type === "assistant_message")
      .map((event) => ({
        kind: event.type === "user_message" ? "user" as const : "assistant" as const,
        text: String(event.payload.text ?? ""),
        key: event.id,
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
      const snapshot = await sendMessage({ text, requestId });
      live = snapshot;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      inflight -= 1;
      pendingTurns = pendingTurns.filter((turn) => turn.id !== requestId);
    }
  }

  function panelDocument(panel: Panel): string {
    const escapedCss = panel.revision.css.replace(/<\/style/gi, "<\\/style");
    const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(panel.revision.clientJs)}`;
    return `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: { svelte: "https://esm.sh/svelte@5", "svelte/": "https://esm.sh/svelte@5/" } })}<\/script><style>body{margin:0;padding:0;background:#fff;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style><style>${escapedCss}</style></head><body><div id="app"></div><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});<\/script></body></html>`;
  }

  function openSource(panel: Panel) {
    selectedPanelId = panel.id;
    mainTab = "source";
  }

  function handlePanelMessage(event: MessageEvent) {
    if (event.data?.type !== "loop:action") return;
    composer = `Focus on ${String(event.data.value ?? "this selection")}.`;
  }

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
    <nav>
      <button class:active={mainTab === "thread"} onclick={() => mainTab = "thread"}>thread</button>
      <button class:active={mainTab === "runtime"} onclick={() => mainTab = "runtime"}>runtime</button>
      <button class:active={mainTab === "source"} onclick={() => mainTab = "source"}>source</button>
    </nav>
    <div class="bar-right">
      <code>{page.data.user?.email ?? "dev/local-jordan"}</code>
      {#if page.data.user}<button class="plain" onclick={() => signOut()}>sign out</button>{/if}
    </div>
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
    <main class="grid">
      <section class="transcript" class:hidden-pane={mainTab !== "thread"}>
        <div class="section-head">
          <span>thread/main</span>
          <code>events {thread.events.length} · context {thread.context.recentEventCount}</code>
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
      </section>

      <section class="runtime" class:hidden-pane={mainTab === "source"}>
        <div class="section-head"><span>{mainTab === "runtime" ? "runtime / mounted surfaces" : "surfaces"}</span><code>{pinnedPanels.length} mounted</code></div>
        <div class="mounts">
          {#each pinnedPanels as panel}
            <article class="mount">
              <header>
                <strong>{panel.id}</strong>
                <code>{panel.revision.sourceHash.slice(0, 10)}</code>
                <button class="plain" onclick={() => openSource(panel)}>source</button>
              </header>
              <iframe title={panel.title} srcdoc={panelDocument(panel)} sandbox="allow-scripts"></iframe>
            </article>
          {/each}
        </div>
      </section>

      {#if mainTab === "source"}
        <section class="source-view">
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
        </section>
      {/if}

      <aside class="inspect">
        <div class="tabs">
          <button class:chosen={sideTab === "state"} onclick={() => sideTab = "state"}>state</button>
          <button class:chosen={sideTab === "memory"} onclick={() => sideTab = "memory"}>memory</button>
          <button class:chosen={sideTab === "events"} onclick={() => sideTab = "events"}>events</button>
        </div>
        {#if sideTab === "state"}
          <dl>
            <dt>thread</dt><dd>main</dd>
            <dt>owner</dt><dd>{page.data.user?.email ?? "local-jordan"}</dd>
            <dt>ledger</dt><dd>{thread.events.length} events</dd>
            <dt>window</dt><dd>{thread.context.recentEventCount} recent</dd>
            <dt>surfaces</dt><dd>{thread.panels.length}</dd>
            <dt>memories</dt><dd>{thread.context.memoryCount}</dd>
          </dl>
          {#if thread.context.checkpointSummary}<pre class="summary">{thread.context.checkpointSummary}</pre>{/if}
        {:else if sideTab === "memory"}
          <div class="records">
            {#each thread.memories.filter((memory) => memory.state === "kept") as memory}
              <article><code>{memory.kind}</code><p>{memory.text}</p></article>
            {/each}
          </div>
        {:else}
          <div class="events">
            {#each [...thread.events].reverse().slice(0, 30) as event}
              <div><code>{event.revision}</code><span>{event.type}</span></div>
            {/each}
          </div>
        {/if}
      </aside>
    </main>
  {/if}
</div>
