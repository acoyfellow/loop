# Deep Comparison: `@acoyfellow/loop` vs. Code Factory Pattern

## Executive Summary

| | **@acoyfellow/loop** | **Code Factory (Carson)** |
|---|---|---|
| **Philosophy** | Prepare vessels; the repo *is* the rig | Enforce contracts; the repo *is* the compliance boundary |
| **Target user** | Solo dev / small team bootstrapping agent loops fast | Team with production traffic, legal/regulatory surface, CI budget |
| **Lines of config to start** | ~0 (one `npx` command) | 100+ across policy JSON, workflows, harness scripts |
| **Time to first agent iteration** | Minutes | Days to weeks |
| **Trust model** | Trust the agent, catch failures reactively | Distrust everything, prove correctness before merge |

---

## 1. Architecture Comparison Matrix

| Dimension | **@acoyfellow/loop** | **Code Factory** | Winner (context-dependent) |
|---|---|---|---|
| **Setup complexity** | Single `npx init` scaffolds everything | Multiple workflow files, policy JSON, harness scripts, review-agent integration | Loop (simplicity) |
| **Machine-readable contract** | `loop.json` — agent choice, failure limit, context files | `risk-policy.json` — risk tiers by path, required checks by tier, docs-drift rules, evidence requirements | Code Factory (rigor) |
| **Risk classification** | None — all files treated equally | Path-based risk tiers (high/low), different merge policies per tier | Code Factory |
| **Pre-merge gating** | None — agent commits directly to main | Multi-stage: policy gate -> review agent -> CI fanout -> evidence verification | Code Factory |
| **Code review** | None — no automated or human review step | Mandatory review-agent (Greptile/CodeRabbit/CodeQL) with SHA-pinned validation | Code Factory |
| **SHA discipline** | None — no concept of head-SHA validation | Core requirement: review state valid only for current PR head commit | Code Factory |
| **CI integration** | Single workflow: run agent -> commit -> push | Multiple workflows: preflight gate, CI fanout, review rerun, auto-resolve, remediation | Code Factory (coverage) / Loop (simplicity) |
| **Failure handling** | Consecutive failure counter -> pause after N | Preflight blocks expensive CI; findings trigger remediation agent loop | Code Factory |
| **Remediation loop** | Agent retries with error context from last 5 failures | Dedicated remediation agent reads review findings, patches, runs local validation, pushes fix commit | Code Factory (precision) |
| **Browser/E2E evidence** | None | First-class: evidence manifests, assertions, freshness checks, identity verification | Code Factory |
| **Incident memory** | Error log (append-only, last 5 fed back to agent) | Harness-gap loop: production regression -> gap issue -> case added -> SLA tracked | Code Factory |
| **Bot comment management** | None | Single canonical rerun writer with SHA-dedupe markers to prevent duplicates | Code Factory |
| **Thread resolution** | None | Auto-resolve bot-only threads after clean rerun; never auto-resolve human threads | Code Factory |
| **Agent agnostic** | Yes — Claude, OpenCode, Aider, custom | Partially — pattern is generic, but implementation couples to specific tools (Codex, Greptile) | Loop |
| **Branching model** | Direct commits to main | PR-based with branch protection, required checks, conversation resolution | Code Factory |

---

## 2. What Loop Has That Code Factory Doesn't

| Feature | Details |
|---|---|
| **Zero-config scaffolding** | One command creates everything needed. No YAML engineering required. |
| **Watch mode** | Continuous local looping with `loop watch` — no CI dependency. |
| **Kill switch** | Physical file (`.loop/PAUSED`) that any process can check — simple, debuggable. |
| **Progress persistence** | Append-only log survives context resets; last 10 entries fed as agent context. |
| **Agent pluggability** | First-class support for 4 agents + custom command. Swap agents without changing infra. |
| **Portability** | Clone repo, run `npx loop enter`. Works anywhere Bun runs. No GitHub-specific dependencies for local use. |
| **Minimal footprint** | 348 lines, zero runtime dependencies. Easy to audit, fork, modify. |

---

## 3. What Code Factory Has That Loop Doesn't

| Feature | Details |
|---|---|
| **Risk-tiered merge policy** | Different validation requirements for high-risk vs low-risk paths. |
| **Preflight gating** | Blocks expensive CI until policy and review state are verified. Saves CI minutes. |
| **Code review agent integration** | Machine-verifiable review state as a merge requirement. |
| **Current-head SHA validation** | Prevents merging on stale "clean" evidence from an older commit. |
| **Deterministic rerun management** | One canonical writer prevents duplicate bot comments and race conditions. |
| **Browser evidence pipeline** | Screenshots/flows as CI artifacts with assertions, not just PR description text. |
| **Automated remediation with guardrails** | Pinned model + effort, skip stale comments, never bypass policy gates. |
| **Harness-gap SLO tracking** | Production regressions systematically converted to test cases with SLA tracking. |
| **Docs-drift detection** | Changes to control-plane files require corresponding doc updates. |
| **Multi-workflow orchestration** | Separate workflows for gate, CI, review rerun, thread cleanup, remediation. |

---

## 4. Pros & Cons

### @acoyfellow/loop

| Pros | Cons |
|---|---|
| Get started in minutes, not days | No pre-merge validation — broken code can land on main |
| Single file, easy to understand and modify | No risk classification — schema migration treated same as README edit |
| Works locally without CI | No code review step — agent output goes unchecked |
| Agent-agnostic by design | No SHA discipline — no protection against stale state |
| Zero runtime dependencies | No branch protection — direct pushes to main |
| Philosophy is compelling ("prepare vessels") | No security scanning, no SAST, no audit |
| Failure counter prevents infinite burn | Error context is shallow (last 5 lines, no structured findings) |
| Git-native persistence model | No E2E/browser evidence |
| Low cost — minimal CI minutes | No incident-to-test-case pipeline |
| Easy to fork and customize | No team collaboration features (CODEOWNERS, PR templates, etc.) |

### Code Factory

| Pros | Cons |
|---|---|
| Defense-in-depth: multiple validation layers | Significant setup cost — days of YAML/policy engineering |
| Risk-aware: high-risk paths get more scrutiny | Tight coupling to specific tools (Greptile, Codex) in practice |
| SHA discipline prevents stale merges | Complex to debug when things go wrong across 5+ workflows |
| CI cost optimization via preflight gating | Requires team familiarity with the control-plane pattern |
| Browser evidence is machine-verifiable | Over-engineered for small projects or solo devs |
| Incident memory grows test coverage over time | Ongoing maintenance burden for policy files and workflow orchestration |
| Automated remediation shortens loop time | Review-agent dependency — if the service is down, merges are blocked |
| Bot thread management reduces noise | No local-first mode — fully dependent on GitHub Actions |
| Auditable, deterministic standards | Higher monthly cost (CI minutes, review-agent API, remediation agent API) |
| Scales to teams with compliance needs | "Harness engineering" itself becomes a full-time job |

---

## 5. When to Use Which

| Scenario | Recommendation |
|---|---|
| Solo dev, side project, exploring agent-driven development | **Loop** |
| Hackathon, prototype, proof-of-concept | **Loop** |
| Open-source library with few contributors | **Loop** (with manual review) |
| Production SaaS with paying customers | **Code Factory** |
| Regulated industry (fintech, healthtech, legal) | **Code Factory** |
| Team > 3 engineers with shared codebase | **Code Factory** (or hybrid) |
| Learning how agent loops work | **Loop** |
| Need to prove compliance/audit trail to stakeholders | **Code Factory** |
| Repo where a bad merge costs real money | **Code Factory** |
| Repo where speed of iteration matters most | **Loop** |

---

## 6. Maturity Ladder: How Loop Could Evolve Toward Code Factory

These are the incremental steps Loop could take to adopt Code Factory concepts without abandoning its simplicity-first philosophy. Ordered by impact-to-effort ratio.

### Tier 1 — Low effort, high impact

| Step | What to add | Complexity |
|---|---|---|
| **PR-based flow** | Agent creates branch + PR instead of pushing to main | Low |
| **Basic CI gate** | Add `npm test` and `npm run build` as required checks before merge | Low |
| **Risk tiers in `loop.json`** | `"riskTiers": { "high": ["db/**", "api/**"] }` — even if only advisory at first | Low |

### Tier 2 — Medium effort, high impact

| Step | What to add | Complexity |
|---|---|---|
| **Review agent hook** | After agent iteration, trigger a review (Greptile, CodeRabbit, or LLM self-review) | Medium |
| **SHA-pinned validation** | Store head SHA in `.loop/`, refuse to merge if review SHA != current head | Medium |
| **Structured error context** | Replace flat error log with JSON entries: `{ sha, error, file, line, category }` | Medium |

### Tier 3 — Higher effort, needed at scale

| Step | What to add | Complexity |
|---|---|---|
| **Preflight policy gate** | Separate workflow that runs before CI fanout | Medium-High |
| **Browser evidence pipeline** | Capture + verify UI evidence as CI artifacts | High |
| **Harness-gap tracking** | Production incident -> test case pipeline with SLO | High |
| **Remediation agent** | Dedicated agent that reads review findings and pushes targeted fixes | High |

---

## 7. The Fundamental Tradeoff

```
Loop's position:         Code Factory's position:

  SPEED                    SAFETY
  ━━━━━●━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━●━━━━━
  Move fast, fail         Every merge is
  cheaply, iterate        provably correct
```

**Loop** optimizes for the inner loop: get an agent writing code and iterating as fast as possible. The bet is that git history + failure limits + human oversight are sufficient guardrails for most early-stage work.

**Code Factory** optimizes for the outer loop: ensure that every change that lands is validated, reviewed, and evidenced. The bet is that the upfront cost pays for itself in avoided incidents, compliance, and team trust.

Neither is wrong. They solve different problems at different scales. The interesting path is Loop's simplicity as the on-ramp, with a clear upgrade path toward Code Factory's rigor as projects mature.

---

## 8. Risk Analysis

| Risk | Loop Exposure | Code Factory Mitigation |
|---|---|---|
| Agent writes buggy code that ships | **High** — no review, no tests required, direct push to main | Review agent + required CI checks + SHA validation |
| Agent introduces security vulnerability | **High** — no SAST, no security scanning | CodeQL/security checks in CI fanout |
| Stale review used to justify merge | **N/A** — no review exists | SHA-pinned validation, rerun on every push |
| CI cost spiral from agent loops | **Low** — 15min timeout, failure limit | Preflight gate blocks expensive CI until policy passes |
| Agent enters infinite non-productive loop | **Medium** — consecutive failure counter catches this | Preflight + review findings provide structured feedback |
| Production regression from agent change | **High** — no regression test pipeline | Harness-gap loop converts incidents to test cases |
| Merge conflicts from concurrent agents | **Medium** — direct push, no branching | PR-based flow with branch protection |
| Agent leaks secrets in committed code | **High** — `git add -A` stages everything | Pre-commit hooks, secret scanning in CI |

---

*Generated 2026-02-16 for @acoyfellow/loop comparison analysis.*
