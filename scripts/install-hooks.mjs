#!/usr/bin/env node
// Wire .githooks/* as this repo's hook path. Idempotent. Safe in CI (skips when GITHUB_ACTIONS=1).
import { spawnSync } from "node:child_process";

if (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true") {
  process.exit(0);
}

const res = spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
if (res.status !== 0) process.exit(0); // not a git checkout; silent skip
