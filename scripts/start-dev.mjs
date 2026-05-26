import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

function killPort(port) {
  try {
    const pids = execSync(`lsof -n -iTCP:${port} -sTCP:LISTEN -t`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim().split(/\s+/).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(Number(pid)); } catch {}
    }
  } catch {}
}

killPort(1337);
killPort(5176);
rmSync(".wrangler/state", { recursive: true, force: true });

const child = spawn("node", ["scripts/dev-all.mjs"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
