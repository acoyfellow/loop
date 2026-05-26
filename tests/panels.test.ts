import { describe, expect, it } from "vitest";
import { compilePanel } from "../worker/panels";

describe("living panels", () => {
  it("compiles Svelte source into an addressable panel revision", async () => {
    const panel = await compilePanel({
      id: "hello",
      title: "Hello",
      source: `<script>let count = $state(0);</script><button onclick={() => count += 1}>{count}</button>`,
    });
    expect(panel.panelId).toBe("hello");
    expect(panel.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(panel.clientJs).toContain("button");
  });

  it("rejects malformed generated UI", async () => {
    await expect(compilePanel({ id: "bad", title: "Bad", source: `<script>let = ;</script>` })).rejects.toThrow(/Svelte compile failed/);
  });
});
