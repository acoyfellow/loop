# @acoyfellow/loop

prepare repos for looping.

## install

```bash
npx @acoyfellow/loop init        # direct mode (push to main)
npx @acoyfellow/loop init --pr   # PR mode (branch + PR + gate checks)
```

## what it creates

```
AGENTS.md              # how to build/test (you edit this)
tasks.md               # what to do (you edit this)
loop.json              # config
.loop/
  progress.md          # what's done (append-only)
  errors.md            # what went wrong (append-only)
  failures             # consecutive failure count
  PAUSED               # kill switch (exists = stopped)
.github/workflows/
  loop.yml             # CI trigger
  loop-gate.yml        # PR checks (--pr mode only)
```

## commands

```bash
npx @acoyfellow/loop init [--pr]  # scaffold files (--pr for PR-based flow)
npx @acoyfellow/loop enter        # one iteration (runs checks + review if configured)
npx @acoyfellow/loop watch        # loop until paused
npx @acoyfellow/loop status       # show state
npx @acoyfellow/loop pause        # stop
npx @acoyfellow/loop resume       # continue
npx @acoyfellow/loop gate         # run configured checks (for CI)
npx @acoyfellow/loop risk-tier    # print risk tier for staged changes
```

## config (loop.json)

```json
{
  "agent": "claude",
  "maxFailures": 5,
  "context": ["AGENTS.md", "tasks.md"],
  "mode": "direct"
}
```

agents: `claude`, `opencode`, `aider`, `custom`

for custom:
```json
{
  "agent": "custom",
  "customCommand": "my-agent --prompt"
}
```

### PR mode with checks + risk tiers

```json
{
  "agent": "claude",
  "maxFailures": 5,
  "context": ["AGENTS.md", "tasks.md"],
  "mode": "pr",
  "checks": ["npm test", "npm run build"],
  "riskTiers": {
    "high": ["db/**", "api/**", "lib/**"]
  },
  "reviewCommand": "npx your-review-tool"
}
```

| field | default | description |
|---|---|---|
| `mode` | `"direct"` | `"direct"` pushes to main, `"pr"` creates branch + PR |
| `checks` | `[]` | commands that must pass after each iteration |
| `riskTiers.high` | `[]` | glob patterns for high-risk paths |
| `reviewCommand` | - | optional command to run a review agent post-iteration |

## the guardrails

1. **something must change** - if agent produces no diff, it's a failure
2. **failure limit** - after N consecutive failures, loop pauses
3. **kill switch** - `.loop/PAUSED` file stops everything
4. **error log** - errors persist so next iteration can avoid them
5. **progress log** - progress persists so loop knows where it left off
6. **risk tiers** - high-risk paths are flagged in progress and PR titles
7. **gate checks** - configured commands must pass before iteration succeeds
8. **review hook** - optional review agent runs after each iteration

## the philosophy

you don't run loops. you prepare vessels to enter loops.

the repo IS the rig. git gives you:
- persistence (survives context resets)
- versioning (every change tracked)
- triggers (actions, webhooks)
- portability (clone anywhere)

you're not controlling the work. you're orchestrating the conditions under which loops can safely run.
