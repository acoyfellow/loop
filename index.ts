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
  mode: "direct" | "pr";
  riskTiers?: { high: string[] };
  checks?: string[];
  reviewCommand?: string;
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
  mode: "direct",
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

  workflowPR: `name: loop

on:
  workflow_dispatch:
  schedule:
    - cron: "0 */6 * * *"

jobs:
  enter:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npx @acoyfellow/loop enter
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      - name: Create PR if changes exist
        run: |
          git config user.name "loop"
          git config user.email "loop@localhost"
          git add -A
          if git diff --cached --quiet; then
            echo "no changes"
            exit 0
          fi
          BRANCH="loop/iteration-\$(date +%s)"
          git checkout -b "\$BRANCH"
          RISK=\$(npx @acoyfellow/loop risk-tier)
          git commit -m "loop: iteration [\$RISK]"
          git push -u origin "\$BRANCH"
          gh pr create --title "loop: iteration [\$RISK]" --body "Automated loop iteration. Risk tier: **\$RISK**" --label "loop"
`,

  gate: `name: loop-gate

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci --ignore-scripts
      - run: npx @acoyfellow/loop gate
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

  const riskNote = cfg.riskTiers?.high
    ? `\n# RISK POLICY\nHigh-risk paths: ${cfg.riskTiers.high.join(", ")}\nBe extra careful with these files. Changes here require all checks to pass.\n`
    : "";

  const checksNote = cfg.checks?.length
    ? `\n# CHECKS\nThese will run after your changes: ${cfg.checks.join(", ")}\nMake sure your changes pass these.\n`
    : "";

  return `${files}

---

# PROGRESS
${prog.join("\n") || "(none)"}

# ERRORS (don't repeat)
${errs.join("\n") || "(none)"}
${riskNote}${checksNote}
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

const getChangedFiles = (): string[] => {
  try {
    const out = execSync("git diff --cached --name-only", { encoding: "utf-8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

// ============================================
// RISK TIERS
// ============================================

const matchGlob = (pattern: string, file: string): boolean => {
  const re = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${re}$`).test(file);
};

const getRiskTier = (files: string[], cfg: Config): "high" | "low" => {
  if (!cfg.riskTiers?.high) return "low";
  for (const file of files) {
    for (const pattern of cfg.riskTiers.high) {
      if (matchGlob(pattern, file)) return "high";
    }
  }
  return "low";
};

// ============================================
// CHECKS & REVIEW
// ============================================

const runChecks = (checks: string[]): { ok: boolean; failed: string[] } => {
  const failed: string[] = [];
  for (const cmd of checks) {
    try {
      execSync(cmd, { stdio: "inherit", timeout: 120_000 });
    } catch {
      failed.push(cmd);
    }
  }
  return { ok: failed.length === 0, failed };
};

const runReview = (command: string): { ok: boolean; msg: string } => {
  try {
    execSync(command, { stdio: "inherit", timeout: 300_000 });
    return { ok: true, msg: "review passed" };
  } catch (e: any) {
    return { ok: false, msg: `review failed: ${e.message}` };
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
  const prMode = process.argv.includes("--pr");
  console.log(`initializing...${prMode ? " (PR mode)" : ""}\n`);

  mkdirSync(".loop", { recursive: true });
  mkdirSync(".github/workflows", { recursive: true });

  if (!exists(P.agents)) { write(P.agents, T.agents); console.log("  AGENTS.md"); }
  if (!exists(P.tasks)) { write(P.tasks, T.tasks); console.log("  tasks.md"); }

  if (!exists(P.config)) {
    const cfg = prMode
      ? { ...DEFAULT_CONFIG, mode: "pr", checks: ["npm test", "npm run build"], riskTiers: { high: ["db/**", "api/**", "lib/**"] } }
      : DEFAULT_CONFIG;
    write(P.config, JSON.stringify(cfg, null, 2));
    console.log("  loop.json");
  }

  const wf = prMode ? T.workflowPR : T.workflow;
  if (!exists(".github/workflows/loop.yml")) { write(".github/workflows/loop.yml", wf); console.log("  .github/workflows/loop.yml"); }

  if (prMode && !exists(".github/workflows/loop-gate.yml")) {
    write(".github/workflows/loop-gate.yml", T.gate);
    console.log("  .github/workflows/loop-gate.yml");
  }

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

  console.log(`\ndone. edit AGENTS.md + tasks.md, then: npx @acoyfellow/loop enter`);
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

  // risk tier detection
  const files = getChangedFiles();
  const tier = getRiskTier(files, cfg);

  // run checks if configured
  if (cfg.checks?.length) {
    const result = runChecks(cfg.checks);
    if (!result.ok) {
      append(P.errors, `checks failed: ${result.failed.join(", ")}`);
      incFail();
      return { ok: false, msg: `checks failed: ${result.failed.join(", ")}` };
    }
  }

  // run review if configured
  if (cfg.reviewCommand) {
    const result = runReview(cfg.reviewCommand);
    if (!result.ok) {
      append(P.errors, result.msg);
      incFail();
      return { ok: false, msg: result.msg };
    }
  }

  resetFail();
  append(P.progress, `iteration done [${tier}] files: ${files.length}`);
  return { ok: true, msg: `changes made [${tier}]` };
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
mode:     ${cfg.mode}
checks:   ${cfg.checks?.length ?? 0} configured
review:   ${cfg.reviewCommand ? "yes" : "no"}
risk:     ${cfg.riskTiers?.high ? cfg.riskTiers.high.length + " high-risk patterns" : "none"}
`);
};

const pause = (): void => { write(P.paused, ""); console.log("paused"); };
const resume = (): void => { try { unlinkSync(P.paused); } catch {} console.log("resumed"); };

const gate = (): void => {
  const cfg = loadConfig();
  const checks = cfg.checks || [];
  if (checks.length === 0) {
    console.log("no checks configured");
    process.exit(0);
  }

  console.log(`running ${checks.length} check(s)...\n`);
  const result = runChecks(checks);

  if (result.ok) {
    console.log("\nall checks passed");
    process.exit(0);
  } else {
    console.log(`\nfailed: ${result.failed.join(", ")}`);
    process.exit(1);
  }
};

const riskTier = (): void => {
  const cfg = loadConfig();
  const files = getChangedFiles();
  const tier = getRiskTier(files, cfg);
  console.log(tier);
};

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
  gate,
  "risk-tier": riskTier,
};

if (!cmd || !commands[cmd]) {
  console.log(`
loop - prepare repos for looping

  init [--pr]  scaffold files (--pr for PR-based flow)
  enter        one iteration (runs checks + review if configured)
  watch        loop until paused
  status       show state
  pause        stop
  resume       continue
  gate         run configured checks (for CI)
  risk-tier    print risk tier for staged changes
`);
  process.exit(0);
}

commands[cmd]();
