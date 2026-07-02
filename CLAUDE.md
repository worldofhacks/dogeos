# DogeSwap — CLAUDE.md

Non-custodial DEX **aggregator** for DogeOS (Dogecoin zkEVM, Chikyū **testnet**,
chain id 6281971). Quotes and routes across MuchFi V2, MuchFi V3, and Barkswap
Algebra; settles split/routed swaps through the first-party command/executor
DogeSwapRouter.

## Layout

| Path | What |
| --- | --- |
| `apps/web/` | React/Vite UI (swap, tokens, activity, settings, chart, SDK wallet connect) |
| `packages/aggregator/` | Quote sourcing, routing/splitting, fees, token index, verification |
| `packages/api/` | HTTP handlers: `/quote` `/swap` `/approval` `/tokens` `/tokenlist` `/chain-status` `/activity` `/sources` `/venues` `/intelligence` `/verification` |
| `packages/web/` | Production server (static app + API), `packages/config/` chain/venue constants, `packages/dogeos-rpc/` RPC client |
| `packages/contracts/` | Audited Foundry router suite + `audit/` package (threat model, invariants, runbooks) |
| `scripts/` | Pool scanner, liquidity discovery, source verification, `blockscout/` API client, `automation/` daily-routine scheduler |
| `e2e/` | Playwright suite (desktop + mobile projects) + performance harness |

## State of record

**`.claude/.roadmap`** is the single source of truth for project state
(Now/Next/Later/Done). Read it at session start; **update it at the end of
every working session** — move done items (with commit hash), add discoveries
with rationale + file paths.

## Skills — invoke by task

| Skill | Reach for it when |
| --- | --- |
| `dex-aggregation` | Quote math, routing/splitting, venue behavior, fees, "why is this quote wrong", comparing to 1inch/0x/CoW, intent-V2 planning |
| `blockscout-scanner` | Tracing txs, decoding failures, activity reconstruction, contract verification, anything Explorer/`/activity`/`/verification` |
| `cross-chain-swaps` | Bridge routes, multi-leg quotes, cross-chain architecture, DogeOS bridge constraints |
| `trail-of-bits-security` | ANY contracts change (mandatory), security review of `/swap`/`/approval`/calldata paths, Slither/Echidna/invariants |

## Daily routine & subagents

`/daily-routine` runs the operating loop: **planner** (day plan from roadmap +
issues) → **implementer** (one branch + PR per task) → **security-reviewer**
(veto power on contracts//swap-path diffs) + **code-reviewer** (all PRs) →
merge on green CI → deploy (`~/dogeswap-deploy/deploy.sh prod`) → **qa-tester**
(Playwright sweep + perf metrics → `docs/qa/<date>.md`, issues per finding) →
**competitive-analyst** (brief → `docs/competitive/<date>.md`) → file issues,
update roadmap. Scheduled 07:00 America/New_York via systemd user timer —
see `docs/automation.md`. Agent definitions: `.claude/agents/`.

## Model policy

Everything runs on **Claude Fable 5** with maximum reasoning: `model:
claude-fable-5` is pinned in `.claude/settings.json` and in every
`.claude/agents/*.md` frontmatter — do not downgrade either, and keep the pin
when adding agents. Planning and security-review steps use extended thinking
(`ultrathink` in their prompts; already encoded in `planner`,
`security-reviewer`, and `/daily-routine`).

## Standing rules

1. **Testnet-only until externally audited.** No mainnet deploy, no mainnet
   copy in the UI.
2. **Never weaken slippage, fee, deadline, approval, or calldata-allowlist
   checks.** If a task appears to require it, stop and flag.
3. **Every contracts change goes through the trail-of-bits-security
   checklist** (forge test, Slither clean-or-triaged, invariants for new
   paths, calldata-composition review) before merge.
4. **Roadmap updated every session** (see above).
5. **Continuous GitHub updates**: commit and push after every coherent unit of
   work throughout every session — never accumulate uncommitted work. One
   branch + PR per task; never push large batches to main.
6. **Environment**: Node ≥22 required — non-interactive shells on this server
   default to node 18, so prefix npm/node commands with
   `export PATH=/home/actlabs/.nvm/versions/node/v22.22.3/bin:$PATH`.
   Never develop inside `/home/actlabs/dogeswap-prod` or `dogeswap-staging`
   (live service checkouts) — use a worktree/clone; deploys go through
   `~/dogeswap-deploy/deploy.sh`.

## Verify, don't assume

DogeOS facts (explorer URL, bridge behavior, RPC quirks) change: verify against
`packages/config/src/chains.mjs`, the skills' dated reference files, or
https://docs.dogeos.com — and when you verify something new, record it in the
relevant skill so the next session doesn't re-check.
