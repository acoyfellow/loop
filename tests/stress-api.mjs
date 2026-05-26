import assert from "node:assert/strict";

const base = "http://127.0.0.1:1337";
const owner = `stress_${Date.now()}`;
const headers = { "content-type": "application/json", "x-loop-owner": owner };
async function get(path) { const response = await fetch(`${base}${path}`, { headers }); assert.equal(response.status, 200, `${path} returned ${response.status}`); return response.json(); }
async function post(path, body) { const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) }); const data = await response.json(); assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(data)}`); return data; }

const initial = await get("/api/thread");
assert.equal(initial.events.length, 0, "new thread must not contain staged demo records");
assert.equal(initial.panels.length, 0, "new thread must not contain seeded panels");
assert.equal(initial.memories.length, 0, "new thread must not contain seeded memories");

const sameId = `retry-${Date.now()}`;
const first = await post("/api/messages", { text: "Respond with the single word acknowledged.", requestId: sameId });
const replay = await post("/api/messages", { text: "Respond with the single word acknowledged.", requestId: sameId });
assert.equal(first.snapshot.events.length, replay.snapshot.events.length, "retry duplicated ledger events");
assert.ok(first.snapshot.events.some((event) => event.type === "assistant_message"), "real model did not answer");

// Build pressure with real writes rather than fabricating inference responses.
for (let index = 0; index < 32; index += 1) {
  await post("/api/memories", { kind: "fact", text: `stress fact ${index}` });
}
const long = await post("/api/messages", { text: "Reply only with checkpoint-ack.", requestId: "checkpoint-turn" }).then((result) => result.snapshot);
assert.ok(long.events.length > 32, "expected expanded ledger");
assert.ok(long.events.some((event) => event.type === "summary_checkpoint"), "expected rolling checkpoint");
assert.ok(long.events.some((event) => event.payload.text === "stress fact 0"), "old exact memory event was lost");

const exported = await get("/api/export");
assert.equal(exported.format, "loop-ledger-v1");
assert.ok(exported.snapshot.events.length >= long.events.length);
console.log(JSON.stringify({ ok: true, owner, events: long.events.length, checkpoint: true, inference: "workers-ai" }));
