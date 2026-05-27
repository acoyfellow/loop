import assert from "node:assert/strict";

const base = "http://127.0.0.1:1337";
const owner = `stress_${Date.now()}`;
const headers = { "content-type": "application/json", "x-loop-owner": owner };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response.json();
}
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const phrase = `stress-${Date.now()}`;

const initial = await get("/api/thread");
assert.equal(initial.messages.length, 0, "new thread must be empty");
assert.equal(initial.panels.length, 0, "new thread must not seed panels");
assert.equal(initial.memories.length, 0, "new thread must not seed memories");

// Real Workers AI turn: ask Loop to create a panel and remember a convention.
const turn = await post("/api/messages", {
  text: `Create a panel id stress-panel-${phrase} titled "Stress ${phrase}" that visibly renders the exact token ${phrase}. Remember the convention: ${phrase} is a stress marker.`,
});
assert.ok(typeof turn.answer === "string", "expected assistant answer string");
assert.ok(turn.snapshot.panels.find((panel) => panel.id === `stress-panel-${phrase}`), "model did not create the requested panel");
assert.ok(turn.snapshot.memories.find((memory) => memory.text.includes(phrase)), "model did not commit the requested memory");

// Re-query — durability check, single Think DO.
const after = await get("/api/thread");
assert.equal(after.stats.memoryCount, turn.snapshot.stats.memoryCount, "memory count must persist");
assert.ok(after.panels.some((panel) => panel.id === `stress-panel-${phrase}`), "panel must persist across reads");

const exported = await get("/api/export");
assert.equal(exported.format, "loop-ledger-v1");
assert.ok(exported.panelRevisions.some((revision) => revision.panel_id === `stress-panel-${phrase}`), "export missing panel revision");

console.log(JSON.stringify({
  ok: true,
  owner,
  messages: after.stats.messageCount,
  panels: after.stats.panelCount,
  memories: after.stats.memoryCount,
  inference: "workers-ai",
}));
