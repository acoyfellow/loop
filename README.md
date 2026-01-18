# @acoyfellow/loop

prepare repos for looping.

## install

```bash
npx @acoyfellow/loop init
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
```

## commands

```bash
npx @acoyfellow/loop init     # scaffold files
npx @acoyfellow/loop enter    # one iteration
npx @acoyfellow/loop watch    # loop until paused
npx @acoyfellow/loop status   # show state
npx @acoyfellow/loop pause    # stop
npx @acoyfellow/loop resume   # continue
```

## config (loop.json)

```json
{
  "agent": "claude",
  "maxFailures": 5,
  "context": ["AGENTS.md", "tasks.md"]
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

## the guardrails

1. **something must change** - if agent produces no diff, it's a failure
2. **failure limit** - after N consecutive failures, loop pauses
3. **kill switch** - `.loop/PAUSED` file stops everything
4. **error log** - errors persist so next iteration can avoid them
5. **progress log** - progress persists so loop knows where it left off

## the philosophy

you don't run loops. you prepare vessels to enter loops.

the repo IS the rig. git gives you:
- persistence (survives context resets)
- versioning (every change tracked)
- triggers (actions, webhooks)
- portability (clone anywhere)

you're not controlling the work. you're orchestrating the conditions under which loops can safely run.
