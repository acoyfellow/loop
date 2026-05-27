#!/usr/bin/env node
// One-shot prod ship: verify locally, push, then trigger the manual deploy workflow.
//
// Requires: `gh` cli authenticated and a clean git tree.
//   bun run ship                 # full: verify + push + deploy
//   bun run ship --skip-verify   # I already verified, just push + deploy
//   bun run ship --no-push       # already pushed, just trigger deploy
//   bun run ship --watch         # follow the deploy run after triggering

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipVerify = args.has("--skip-verify");
const noPush = args.has("--no-push");
const watch = args.has("--watch");

function run(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    console.error(`\n\u2717 ${cmd} ${argv.join(" ")} exited with code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

function capture(cmd, argv) {
  const res = spawnSync(cmd, argv, { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  return res.stdout.trim();
}

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty) {
  console.error("\u2717 working tree dirty. commit or stash first:\n" + dirty);
  process.exit(1);
}

if (!skipVerify) {
  console.log("\u2192 verify (check + test + build)");
  run("bun", ["run", "verify"]);
}

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  console.error(`\u2717 not on main (current: ${branch})`);
  process.exit(1);
}

if (!noPush) {
  console.log("\u2192 git push origin main");
  run("git", ["push", "origin", "main"]);
}

console.log("\u2192 gh workflow run deploy");
run("gh", ["workflow", "run", "deploy", "--repo", "acoyfellow/loop"]);

if (watch) {
  // gh needs a beat to register the new run
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const id = capture("gh", [
    "run",
    "list",
    "--repo",
    "acoyfellow/loop",
    "--workflow",
    "deploy",
    "--limit",
    "1",
    "--json",
    "databaseId",
    "--jq",
    ".[0].databaseId",
  ]);
  console.log(`\u2192 watching run ${id}`);
  run("gh", ["run", "watch", id, "--repo", "acoyfellow/loop"]);
}

console.log("\n\u2714 shipped. https://loop.coey.dev");
