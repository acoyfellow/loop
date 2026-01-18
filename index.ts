#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

// ============================================
// TYPES
// ============================================

interface Config {
  agent: "claude" | "opencode" | "aider" | "custom";
  customCommand?: string;
  maxFailures: number;
  context: string[];
}

interface State {
  progress: string[];
  errors: string[];
  failures: number;
  paused: boolean;
}

type R = { ok: true; msg: string } | { ok: false; msg: string };

// ============================================
// PATHS (the protocol)
// ============================================

const P = {
  config: "loop.json",
  agents: "AGENTS.md",
  tasks: "tasks.md",
  progress: ".loop/progress.md",
  errors: ".loop/errors.md",
  failures: ".loop/failures",
  paused: ".loop/PAUSED",
} as const;

// ============================================
// DEFAULTS
// ============================================

const DEFAULT_CONFIG: Config = {
  agent: "claude",
  maxFailures: 5,
  context: ["AGENTS.md", "tasks.md"],
};

// ============================================
// TEMPLATES
// ============================================

const T = {
  agents: `# AGENTS

## About
<!-- what is this project -->

## Build
\`\`\`bash
npm run build
\`\`\`

## Test
\`\`\`bash
npm test
\`\`\`

## Constraints
<!-- patterns to follow, things to avoid -->
`,

  tasks: `# Tasks

- [ ] first thing to do
- [ ] second thing to do
- [ ] third thing to do
`,

  workflow: `name: loop

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  enter:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npx @acoyfellow/loop enter
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - run: |
          git config user.name "loop"
          git config user.email "loop@localhost"
          git add -A
          git diff --cached --quiet || git commit -m "loop: iteration"
          git push
`,
};

// ============================================
// FILESYSTEM HELPERS
// ============================================

const read = (p: string): string | null => {
  try { return readFileSync(p, "utf-8"); } catch { return null; }
};

const write = (p: string, c: string): void => {
  const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null;
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, c);
};

const append = (p: string, line: string): void => {
  const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null;
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(p, `${new Date().toISOString()}: ${line}\n`);
};

const exists = existsSync;

// ============================================
// STATE
// ============================================

const loadConfig = (): Config => {
  const raw = read(P.config);
  if (!raw) return DEFAULT_CONFIG;
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; } catch { return DEFAULT_CONFIG; }
};

const loadState = (): State => ({
  progress: (read(P.progress) || "").split("\n").filter(Boolean),
  errors: (read(P.errors) || "").split("\n").filter(Boolean),
  failures: parseInt(read(P.failures) || "0", 10),
  paused: exists(P.paused),
});

const incFail = (): number => {
  const n = parseInt(read(P.failures) || "0", 10) + 1;
  write(P.failures, String(n));
  return n;
};

const resetFail = (): void => write(P.failures, "0");

// ============================================
// CONTEXT BUILDER (token thrift lives here)
// ============================================

const buildPrompt = (cfg: Config, state: State): string => {
  const files = cfg.context.map((p) => {
    const c = read(p);
    return c ? `# ${p}\n${c}` : null;
  }).filter(Boolean).join("\n\n---\n\n");

  const errs = state.errors.slice(-5);
  const prog = state.progress.slice(-10);

  return `${files}

---

# PROGRESS
${prog.join("\n") || "(none)"}

# ERRORS (don't repeat)
${errs.join("\n") || "(none)"}

# JOB
Pick one uncompleted task. Do it. Run tests. Mark done when passing.
`;
};

// ============================================
// GIT
// ============================================

const hasChanges = (): boolean => {
  try {
    execSync("git add -A", { stdio: "ignore" });
    execSync("git diff --cached --quiet", { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
};

// ============================================
// AGENTS
// ============================================

type Agent = (prompt: string) => Promise<void>;

const runProc = (cmd: string, args: string[], stdin?: string): Promise<void> =>
  new Promise((res, rej) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] });
    if (stdin) { proc.stdin.write(stdin); proc.stdin.end(); }
    proc.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} exit ${c}`))));
    proc.on("error", rej);
  });

const agents: Record<string, Agent> = {
  claude: (p) => runProc("claude", ["--dangerously-skip-permissions", "--print"], p),
  opencode: (p) => runProc("opencode", ["run", "--message", p]),
  aider: (p) => runProc("aider", ["--message", p, "--yes"]),
  custom: async (p) => {
    const cfg = loadConfig();
    if (!cfg.customCommand) throw new Error("no customCommand in config");
    await runProc("sh", ["-c", cfg.customCommand], p);
  },
};

// ============================================
// COMMANDS
// ============================================

const init = (): void => {
  console.log("initializing...\n");

  mkdirSync(".loop", { recursive: true });
  mkdirSync(".github/workflows", { recursive: true });

  if (!exists(P.agents)) { write(P.agents, T.agents); console.log("  AGENTS.md"); }
  if (!exists(P.tasks)) { write(P.tasks, T.tasks); console.log("  tasks.md"); }
  if (!exists(P.config)) { write(P.config, JSON.stringify(DEFAULT_CONFIG, null, 2)); console.log("  loop.json"); }
  if (!exists(".github/workflows/loop.yml")) { write(".github/workflows/loop.yml", T.workflow); console.log("  .github/workflows/loop.yml"); }

  write(P.progress, "");
  write(P.errors, "");
  write(P.failures, "0");
  console.log("  .loop/");

  // gitignore
  const gi = read(".gitignore") || "";
  if (!gi.includes(".loop/failures")) {
    appendFileSync(".gitignore", "\n.loop/failures\n");
    console.log("  .gitignore");
  }

  console.log("\ndone. edit AGENTS.md + tasks.md, then: npx @acoyfellow/loop enter");
};

const enter = async (): Promise<R> => {
  const cfg = loadConfig();
  const state = loadState();

  if (state.paused) return { ok: false, msg: "paused" };

  if (state.failures >= cfg.maxFailures) {
    write(P.paused, "");
    return { ok: false, msg: `${state.failures} failures, pausing` };
  }

  const prompt = buildPrompt(cfg, state);
  const agent = agents[cfg.agent];
  if (!agent) return { ok: false, msg: `unknown agent: ${cfg.agent}` };

  try {
    await agent(prompt);
  } catch (e: any) {
    append(P.errors, `agent: ${e.message}`);
    incFail();
    return { ok: false, msg: e.message };
  }

  if (!hasChanges()) {
    append(P.errors, "no changes");
    incFail();
    return { ok: false, msg: "no changes" };
  }

  resetFail();
  append(P.progress, "iteration done");
  return { ok: true, msg: "changes made" };
};

const watch = async (): Promise<void> => {
  console.log("watching... (ctrl+c to stop)\n");
  let i = 0;
  while (true) {
    console.log(`[${++i}]`);
    const r = await enter();
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.msg}`);
    if (!r.ok && (r.msg === "paused" || r.msg.includes("failures"))) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
};

const status = (): void => {
  const cfg = loadConfig();
  const state = loadState();
  console.log(`
paused:   ${state.paused}
failures: ${state.failures}/${cfg.maxFailures}
progress: ${state.progress.length}
errors:   ${state.errors.length}
agent:    ${cfg.agent}
`);
};

const pause = (): void => { write(P.paused, ""); console.log("paused"); };
const resume = (): void => { try { unlinkSync(P.paused); } catch {} console.log("resumed"); };

// ============================================
// CLI
// ============================================

const cmd = process.argv[2];

const commands: Record<string, () => void | Promise<void>> = {
  init,
  enter: async () => {
    const r = await enter();
    console.log(r.ok ? `✓ ${r.msg}` : `✗ ${r.msg}`);
    process.exit(r.ok ? 0 : 1);
  },
  watch,
  status,
  pause,
  resume,
};

if (!cmd || !commands[cmd]) {
  console.log(`
loop - prepare repos for looping

  init     scaffold AGENTS.md, tasks.md, .loop/, workflow
  enter    one iteration
  watch    loop until paused
  status   show state
  pause    stop
  resume   continue
`);
  process.exit(0);
}

commands[cmd]();
