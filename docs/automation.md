# Daily automation

The daily operating loop — plan → implement → review → merge → deploy → QA →
competitive brief → close the loop — is defined once, in
`.claude/commands/daily-routine.md`, and can be triggered three ways:

1. **Manually, in any session**: type `/daily-routine`.
2. **Scheduled on the project server** (the active mechanism): a systemd user
   timer runs it headless at **07:00 America/New_York** daily.
3. **GitHub Actions** (`.github/workflows/daily-routine.yml`): dormant.
   Claude Code on the server authenticates via OAuth; no `ANTHROPIC_API_KEY`
   exists in the repo's Actions secrets, so the workflow is manual-dispatch
   only and exits with a notice until a key is provisioned (`gh secret set
   ANTHROPIC_API_KEY`, then uncomment the `schedule:` block — mind the
   UTC-cron DST caveat documented in the file).

## Server scheduler (systemd user units)

Files live in `scripts/automation/`:

| File | Purpose |
| --- | --- |
| `daily-routine.sh` | Wrapper: pins Node 22 + `~/.local/bin` on PATH, syncs the dedicated checkout, runs `claude -p "/daily-routine"` with an explicit `--allowedTools` list (never `--dangerously-skip-permissions`), logs to `~/dogeswap-routine-logs/<date>.log`. |
| `dogeswap-daily-routine.service` | Oneshot unit, 6h timeout. |
| `dogeswap-daily-routine.timer` | `OnCalendar=*-*-* 07:00:00 America/New_York` (systemd handles DST — no cron caveat), `Persistent=true` so a downed server catches up on boot. |

### Install / update (idempotent)

```sh
# one-time bootstrap: the routine works in its own checkout, never the live
# prod/staging service directories
git clone https://github.com/worldofhacks/dogeos.git ~/dogeswap-routine

cp ~/dogeswap-routine/scripts/automation/dogeswap-daily-routine.{service,timer} \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now dogeswap-daily-routine.timer
```

The wrapper `git reset --hard`s the checkout to `origin/main` at the start of
every run, so the units and command definition self-update after the initial
install (re-copy the unit files only if the units themselves change).

### Operate

```sh
systemctl --user list-timers dogeswap-daily-routine.timer   # next run
systemctl --user start dogeswap-daily-routine.service       # run now (headless)
tail -f ~/dogeswap-routine-logs/$(date +%F).log              # follow a run
journalctl --user -u dogeswap-daily-routine.service          # unit-level log
```

### Requirements on the server

- Claude Code CLI authenticated (OAuth credentials in `~/.claude/`).
- `gh` authenticated with `repo` + `workflow` scopes (push, PR, issues).
- Node 22 via nvm at `/home/actlabs/.nvm/versions/node/v22.22.3` (the wrapper
  pins this path; system node is 18 and silently breaks `npm test`).
- `forge` (Foundry) and `slither` (`~/.local/bin/slither`, installed via
  `uv tool install slither-analyzer`).
- Playwright browsers for the QA sweep: `npx playwright install chromium`.
- Deploy access: `~/dogeswap-deploy/deploy.sh` (see `README-DEPLOY.md` there).

## Permission model

The headless run gets an explicit tool allowlist (file edits, git/gh, npm/node,
forge/slither, curl, the deploy script, web search, subagents) — the full list
is in `daily-routine.sh`. Anything outside the list is denied by the harness.
The routine's own guardrails (security-reviewer veto, CI-green merge gate,
standing rules in `CLAUDE.md`) are enforced by the command definition itself.
