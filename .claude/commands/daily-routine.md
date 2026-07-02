---
description: Run the full daily operating loop — plan, implement, review, merge, deploy, QA sweep, competitive brief, close the loop. Runs unattended at 07:00 America/New_York via systemd timer; also runnable manually.
---

You are running the DogeSwap daily routine. Work through the steps IN ORDER;
each step's output feeds the next. Use the Agent tool with the named
`subagent_type` for every delegated step. Environment: prefix every npm/node
command with `export PATH=/home/actlabs/.nvm/versions/node/v22.22.3/bin:$PATH`
(system node is 18 and silently breaks the test suite). Never work inside
`/home/actlabs/dogeswap-prod` or `dogeswap-staging` (live service checkouts) —
you should be running from the routine checkout (`/home/actlabs/dogeswap-routine`).

Standing rules bind every step: testnet-only until externally audited; never
weaken slippage/fee/approval checks; contracts changes go through the
trail-of-bits-security checklist; commit and push after every coherent unit of
work; one branch + PR per task, never batch pushes to main.

## 1. Plan (ultrathink)
`git fetch origin && git reset --hard origin/main`, then launch the `planner`
agent (it reads `.claude/.roadmap`, `gh issue list`, open PRs, yesterday's
`docs/qa/` and `docs/competitive/` reports). Include the word **ultrathink** in
its prompt. Review the returned plan yourself before any implementation: drop
any task that violates the standing rules, and re-order if dependencies look
wrong. The reviewed plan is the contract for the day. If there are unmerged
PRs from a previous run, finishing those IS the first plan item.

## 2. Implement — one branch + PR per task
For each planned task, in plan order, launch an `implementer` agent with the
task's full text (scope, acceptance criteria, risk class). One task per agent
invocation. It branches from origin/main, commits and pushes after every
coherent unit, and opens a PR. Do not start a task whose dependency PR hasn't
merged. If an implementer reports a mis-scoped task, skip it and record why
for the roadmap update in step 7.

## 3. Review gates — fix findings before merge
For every PR, in order:
1. If the diff touches `packages/contracts/**`, `packages/aggregator/src/swap/`,
   the `/swap`/`/approval` handlers, or `sources/registry.mjs`: launch
   `security-reviewer` (include **ultrathink** in its prompt). A BLOCK verdict
   is a veto — send the findings back to an `implementer` on the same branch,
   then re-run `security-reviewer`. Loop until PASS.
2. Launch `code-reviewer` on every PR. REQUEST-CHANGES follows the same
   fix-and-re-review loop.
3. Wait for CI: `gh pr checks <n> --watch`. Merge only when security PASS (where
   applicable) + code review APPROVE + CI green: `gh pr merge <n> --squash`.
Never merge over a red check; never bypass a veto.

## 4. Deploy
After all merges: `~/dogeswap-deploy/deploy.sh prod` (pull → npm ci → build →
restart → health check). Verify: `curl -s https://dogeswap.ag/chain-status`
returns `"live":true` and the app serves. If deploy or health fails: revert
the offending merge on main (`git revert`), push, redeploy, and file an issue
with the failure output. Deploy staging too if its branch moved.

## 5. QA sweep
Launch `qa-tester` against the live deployment (default
`E2E_BASE_URL=https://dogeswap.ag`). It runs the full `e2e/` suite across the
desktop + iPhone + Android projects, measures performance (Lighthouse, quote
latency, TTI, bundle delta vs yesterday), writes `docs/qa/<date>.md`, and files
a GitHub issue per finding. Performance regressions vs yesterday are
automatically high priority.

## 6. Competitive brief
Launch `competitive-analyst`. It writes `docs/competitive/<date>.md`
(aggregators, bridges, intent platforms incl. NEAR Intents, DogeOS ecosystem)
with copy/defend/incident sections and cited URLs.

## 7. Close the loop
1. File a GitHub issue (`gh issue create`) for every actionable finding from
   steps 3–6 that isn't already an issue (search first). Security findings that
   were fixed pre-merge don't need issues; deferred ones do.
2. Update `.claude/.roadmap`: move done items to Done (with commit hashes), add
   new items with one-line rationale + file paths, correct anything reality
   contradicted.
3. Commit the roadmap + `docs/qa/` + `docs/competitive/` files on a branch
   (`routine/close-loop-<date>`), open a PR, and merge it when CI is green
   (docs-only, no review gate needed).
4. Finish with a summary: tasks shipped (PR numbers), findings filed (issue
   numbers), deploy status, QA/perf verdict vs yesterday, and anything left
   half-done for tomorrow's planner.
