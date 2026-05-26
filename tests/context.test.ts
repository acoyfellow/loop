import { describe, expect, it } from "vitest";
import { buildRollingPrompt, shouldCheckpoint } from "../worker/context";
import type { LoopEvent, Memory, Panel } from "../worker/types";

const event = (revision: number, type: LoopEvent["type"], text: string): LoopEvent => ({
  revision,
  id: String(revision),
  type,
  committedAt: new Date().toISOString(),
  payload: { text },
});

describe("rolling context", () => {
  it("injects durable memory and panels without requiring the full transcript", () => {
    const memories: Memory[] = [{ id: "m", kind: "preference", text: "Orange means active build work.", committedAt: "now", sourceRevision: 1, state: "kept" }];
    const panels = [{ id: "active-work", title: "Active work", revision: { sourceHash: "abcd12345678" } }] as unknown as Panel[];
    const prompt = buildRollingPrompt({ summary: "Earlier events are durable.", memories, panels, recentEvents: [event(9, "assistant_message", "Welcome back")] }, "What does orange mean?");
    expect(prompt).toContain("Orange means active build work.");
    expect(prompt).toContain("active-work: Active work");
    expect(prompt).toContain("Jordan: What does orange mean?");
  });

  it("creates a checkpoint trigger without deleting old events", () => {
    const events = Array.from({ length: 33 }, (_, index) => event(index + 1, "user_message", `turn ${index}`));
    expect(shouldCheckpoint(events)).toBe(true);
    expect(events).toHaveLength(33);
  });
});
