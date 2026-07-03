# Staged roadmap update — 2026-07-03

The 2026-07-03 routine session could not write `.claude/.roadmap` (or
`.claude/skills/*`): paths under `.claude/` are permission-blocked for the
unattended session (see issue #21). This file is the ready-to-apply
replacement. **To apply: copy the "Roadmap content" section below over
`.claude/.roadmap` verbatim, then apply the skill-doc fixes in the appendix,
then delete this file.**

---

## Roadmap content

# DogeSwap Roadmap — state of record

This file is the single source of truth for project state. **Update it at the end
of every working session**: move finished items to Done (with commit hash), add
newly discovered work with a one-line rationale and the files it touches.
Ordering within a section is priority order.

Product: non-custodial DEX aggregator for DogeOS (Dogecoin zkEVM, Chikyū
testnet, chain id 6281971). Venues: MuchFi V2, MuchFi V3, Barkswap Algebra.
First-party command/executor router (`packages/contracts/`) settles split and
router-mode swaps. **Testnet-only until externally audited.**

---

## Now

1. **Redeploy hardened router + execute governance handover** (issue #20) — the
   live router `0xa3158549f38400F355aDf20C92DA1769620Aa35A` is an immutable
   **pre-hardening** build (lacks H1–H11), and EOA `0xE659…2873` still owns both
   router and registry — timelock `acceptOwnership()` never executed.
   Highest-severity open item; competitive brief 2026-07-03 (SwapNet $16.8M
   approval-bypass exploit + DogeOS mainnet window June–Aug 2026) makes it
   critical path. → `packages/contracts/audit/REDEPLOY-RUNBOOK.md`,
   `~/dogeswap-deploy/deploy-router.sh`
2. **Deploy main to prod + re-run live QA** (issue #21) — all nine 2026-07-03
   PRs are merged but prod serves the 2026-07-02 build (deploy.sh blocked by
   session permissions); live site carries two already-fixed defects (fee-unit
   scoring, tap targets). Fix the permission allowlist, deploy, re-sweep.
3. **/quote catch-all: 400 → correct status + redaction** — every thrown error
   becomes a client-fault 400 `invalid-quote-request` with the raw
   `error.message` (RPC endpoint details can leak; transient outages read as
   client errors). Also redact raw upstream messages in `telemetry.sourceErrors`
   and 422 bodies. → `packages/api/src/handler.mjs:876-881,917,980`
4. **Server-side deadline validation** (issue #16; audit Medium) —
   `quote.deadline` is client-supplied and unchecked; MuchFi V3 exact-output
   direct calldata carries no deadline, so those swaps have no expiry. Range
   check + floor in /swap; thread a deadline into the V3 exact-output builder.
   → `packages/aggregator/src/swap/venueCalldataBuilders.mjs:109-121`,
   `packages/api/src/handler.mjs`
5. **sdk-wallet-provider bundle split** (issue #13, QA 2026-07-03) — 13.7MB
   (3.87MB gzip) chunk drives live mobile LH-interactive to ~26s and desktop
   Lighthouse to 31. Lazy-load/split the SDK wallet provider.
   → `apps/web` (sdk-wallet chunk, vite config)
6. **Verification snapshot single-flight** (issue #15 made it user-visible:
   /venues cold request 4–6s) — concurrent `/venues` + `/intelligence` +
   `/verification` after TTL expiry each trigger a full verification run;
   consider stale-while-revalidate like the token index.
   → `packages/aggregator/src/verification/verificationSnapshot.mjs:865-877`
7. **Slippage lower-bound guard in UI** — 0% (or dust) slippage is accepted and
   near-guarantees on-chain reverts; add a floor/warning.
   → `apps/web/src/ui/useSettings.js:33-37`, `apps/web/src/ui/SwapView.jsx:787-795`
8. **Timeouts on all Blockscout fetches** — activity, token-icon, holders, and
   deployer lookups have no AbortSignal; a stalled explorer pins requests to
   the 30s server timeout and stalls token-index builds.
   → `packages/api/src/handler.mjs:127`, `packages/api/src/live.mjs:333,385,405`
9. **useQuote brownout dead-end** — after transient-retry exhaustion the hook
   stays in `scanning` forever instead of surfacing the unavailable state.
   → `apps/web/src/ui/useQuote.js:150-155`
10. **Toast stack blocks bottom nav in landscape** (issue #14, QA 2026-07-03) —
    `anim-rise` pills are `pointerEvents:auto` over the nav; e2e caught a real
    intercepted tap. → `apps/web/src/ui` (toast container)
11. **E2E suite in CI** (issue #19) — 35-test Playwright suite is not in CI;
    also declare `chrome-launcher` devDep (phantom dep bit the perf harness)
    and mock the Blockscout `token-transfers` route in e2e fixtures.
    → `.github/workflows/`, `package.json`, `e2e/fixtures/mock-api.mjs`
12. **Fee-rate provider hardening** (issue #17, PR #10 follow-ups) — cache cap
    /eviction, in-flight probe dedup, negative-cache asymmetry, null-rate
    guard. Ranking-only blast radius. → `packages/api/src/live.mjs`
13. **crosschain quoteSchema fixes** (issue #18, PR #6 follow-ups) — refunded
    shadows partial status; lenient chainId ("0"/"-5") validation; phase-1
    hazards recorded. → `packages/aggregator/src/crosschain/quoteSchema.mjs`
14. **Stale docs sweep** — dex-aggregation SKILL.md classifier section predates
    PR #11 (HTTP 408/429/5xx wording, dead `a2e828c` hash, missing revert-first
    precedence); trail-of-bits SKILL.md still calls the permit2 CI install
    untagged (pinned in #4) and says runtime 11,831 B (now 12,683 B);
    SLITHER_TRIAGE.md says 11 residuals (now 9); record permit2 SHA
    `cc56ad0f…` in REPRODUCIBILITY.md. See appendix of
    `docs/roadmap-2026-07-03-update.md` for ready-made text.

## Next

- **Cross-chain swaps, phase 1** — phase 0 (read-only schema, flag-off) shipped
  2026-07-03 (#6, `12c063a`). Phase 1 design refresh per competitive brief
  2026-07-03: rewrite the NEAR-Intents spec against KyberCross OneClick +
  ERC-7683 (aggregator-at-both-ends shape); constraint from the June-14 $127M
  bridge exploit — any integration must be **finality-aware**, never
  inclusion-signed. Canonical L1 portal remains the only DogeOS bridge.
  → `docs/cross-chain-design.md`,
  `docs/superpowers/specs/2026-06-06-dogeos-cross-chain-near-intents-spec.md`
- **Executable one-hop routes** — one-hop candidates are hard-coded
  `readOnly`/preview-only even though the router can run them as a single
  program; compose and execute via DogeSwapRouter.
  → `packages/aggregator/src/routes/oneHop.mjs:44-46,120-125`
- **SuchSwap venue activation** — a live SuchSwap WDOGE/USDC pool exists but the
  venue sits on the watchlist pending router/quoter confirmation; run the
  adapter-verification checklist and promote (or document why not).
  → `packages/aggregator/src/sources/registry.mjs:443-505`, `docs/adapter-verification.md`
- **Exact-output split + one-hop** — the router command set is exact-input
  only, so exact-output requests are always single-venue direct; extend
  composition (needs reverse-order leg sizing).
  → `packages/aggregator/src/routes/splitRoutes.mjs:23`, `oneHop.mjs:80`
- **Creator-reputation persistence** — guilt-by-association flags are lost on
  every restart (onChange hook exists, never wired); also make route-probe
  failures distinguishable from RPC outages before guilt-flagging deployers.
  → `packages/api/src/live.mjs:401`, `packages/aggregator/src/discovery/creatorReputation.mjs`,
  `tokenIndex.mjs:154-159`
- **Rate-limiter hardening** — the counter map clears ALL clients above 10k
  tracked entries (distinct-IP spray defeats it); move to LRU eviction +
  sliding window. → `packages/api/src/httpHardening.mjs:80-83`
- **Mainnet-readiness ledger** (each small, all required before mainnet):
  pin `CORS_ALLOW_ORIGIN` (`packages/api/src/handler.mjs:13-17`); ship a real
  CSP incl. tomo.inc wallet frames (`httpHardening.mjs:96-97`); re-vendor
  contracts `lib/` as pinned submodules (`audit/REPRODUCIBILITY.md:44-54`);
  fill the deploy-evidence table (`audit/DEPLOYMENT.md §7`); Docker non-root +
  multi-stage; `.nvmrc` + engine-strict (system Node 18 silently breaks
  `npm test`); move governance key off the web host; self-host fonts;
  **schedule the external audit now** (DogeOS mainnet window June–Aug 2026 per
  competitive 2026-07-03) and write a **day-1 cutover runbook** (venues, token
  index seed, Permit2 verification, hardened-router deploy, UI copy) —
  incumbents (1inch on Robinhood Chain, Relay day-1 adds) arrive at launch;
  registrar lock + DNSSEC (CoW's $1.2M loss was a domain hijack).
- **Fee activation decision** — protocol fee is 0 bps today; H10 closed the
  fee-evasion path in source but the residual round-trip refund case
  (`DogeSwapRouter.sol:353`) is open — decide fee level + close or accept the
  residual before enabling. → `packages/contracts/src/DogeSwapRouter.sol`
- **Unique-trader trust signal** — needs swap-log indexing (Blockscout logs are
  now wrapped by `scripts/blockscout/`); strengthens the token trust score.
  → `packages/aggregator/src/discovery/trustScore.mjs:8-10`
- **Retire or fix the stale scope guard** — `verify-repository-scope.mjs` flags
  the now-first-party contracts (994 false violations).
  → `scripts/verify-repository-scope.mjs:36-51`

## Later

- **Intent/solver V2** — UniswapX/CoW-style auction: signed intents, resolver
  set, Dutch-auction pricing, batch settlement; the migration path from
  offchain-quote+onchain-settlement is sketched in the dex-aggregation skill.
  NEAR-Intents integration (spec D) rides the same abstraction.
- **External audit** — after router redeploy + governance handover; the
  audit package (`packages/contracts/audit/`) is the hand-off artifact.
  Scheduling moved up to the mainnet-readiness ledger (see Next).
- **Mainnet deploy** — gated on: external audit, governance ceremony (Safe
  multisig + timelock, guardian split), mainnet-readiness ledger above,
  real liquidity (testnet routable depth is ~1,190 WDOGE — aggregation is a
  moat only if mainnet venues have real depth).
- **MEV posture** — tip-ordered mempool today; revisit private orderflow /
  auction protection when DogeOS mainnet mempool rules are known.

## Done

- **2026-07-03 — Review-and-land day: all nine open PRs merged, quote
  correctness + ops foundation**. Permit2 CI pin adjudicated (`cc56ad0f…`
  correct; #7's `cc306b6` would not compile) and merged (#4, `e7ff7af`); JS CI
  on Node 22 + `.env.example` router defaults (#7, `21e77dd`); contracts
  rename + audit notes doc, bytecode proven byte-identical (#8, `119ec4c`);
  fee-unit scoring fix — WDOGE-probe rate provider converts native-wei fees to
  output-token units, kills the ~1e12 overweighting on 6-dec outputs (#10,
  `483ed0d`); token-index warm on prod entrypoint (#12, `c44f9e5`); transient
  classifier precedence fix incl. real V8 CRLF parse-error shapes + broad HTTP
  transient restore after review catch (#11, `77f79b6`); /activity pagination
  allowlist (7 Blockscout cursor keys, shape-validated, cursor withheld when
  slicing dropped items — review caught the 21–50 skip) (#9, `c1844e7`);
  Playwright E2E foundation, 35 tests × 5 projects + perf harness + tap-target
  fixes (#5, `ed685f2`); cross-chain phase-0 read-only schema behind
  `CROSSCHAIN_ENABLED` (#6, `12c063a`). QA: local suite 35/35; live sweep
  29/35 (all failures fixed-on-main or filed); perf flat vs 2026-07-02 except
  an inconclusive LH 91→78 swing (bundle byte-identical; re-check tomorrow).
  Issues filed: #13–#15 (QA), #16–#20 (review follow-ups + tracking), #21
  (deploy blocked). **Deploy did NOT happen** — see Now #2. Roadmap items
  closed: old Now #2/#3/#5/#6/#7/#11/#14/#15 + Next phase 0.
- **2026-07-02 — Claude knowledge infrastructure**: roadmap;
  `.claude/skills/` (blockscout-scanner, dex-aggregation, cross-chain-swaps,
  trail-of-bits-security); `.claude/agents/` (planner, implementer,
  security-reviewer, code-reviewer, competitive-analyst, qa-tester);
  `/daily-routine` command + scheduler; model policy (Fable 5); CLAUDE.md.
- **2026-06-30 → 07-01 — Quote reliability**: transient venue retries, 4s
  per-venue budgets, and the root fix — transient-aware venue timeout runner
  (`1e3586d`, `4dac397`, `c32bc98`). Deployed prod+staging.
- **2026-06-24 → 06-30 — Pool scanner + token index**: 6h systemd scan
  routine, incremental reorg-aware 10-min scans, round-trip + min-liquidity
  routability gate, graduated trust score + tier badges, versioned
  `/tokenlist` (Uniswap Token Lists), guilt-by-association creator filter,
  stale-while-revalidate `/tokens` (`283adc6`…`4da834e`).
- **2026-06-25 → 06-27 — Track-2 audit fixes + UI correctness**: 5%/500bps
  slippage cap, route-aware data-finality fee, Blockscout success link,
  native-DOGE balance, nonce guidance, OG meta (`833ee40`); `ds-` keyframe
  namespace fix (`f3bc112`); countdown aligned to the real 10s poll.
- **2026-06-16 + 06-26 — Router hardening in source**: H1–H9 (`fbb6206`),
  H10 fee-evasion close + H11 permit front-run tolerance (`64640e4`); forge
  suite 60 passing. Live router predates these (Now #1).
- **2026-06-15 → 06-18 — Connect performance**: hybrid experiments reverted;
  final: SDK-only Connect with idle pre-mount (`37f838d`) + immutable hashed
  asset caching (`d37a764`).
- **2026-06-12 — Deployed to testnet**: Permit2 canonical live; Timelock
  `0xf341…1773`; DogeSwapRouter `0xa315…Aa35A`; Registry `0xC596…1215`
  (see `audit/DEPLOYMENT.md`; governance handover still pending — see Now #1).
- **2026-06-11 → 06-13 — Audit round 1 + router goes live**: multi-agent repo
  audit (0 Crit / 4 High / 31 Med / 26 Low) and fixes (`43d8337`); router
  integrated: atomic split swaps, single-approval in-tx Permit2 permit, router
  mode `all` (`80ca6e6`, `504d56c`, `20bd812`); token discovery (paste-a-token,
  pool enumeration, round-trip honeypot gate); gas tip scaled to DogeOS base
  fee.
- **2026-06-07 → 06-08 — React app**: shell, swap view + quote engine,
  execution flow, tokens/activity/settings/chart (real TradingView, no
  fabricated history), SDK-first connect, server run guide + Dockerfile.
- **2026-06-06 → 06-07 — Router program**: specs (premium-aggregator v2,
  router, routing engine, NEAR-Intents cross-chain) then the full
  command/executor DogeSwapRouter build: ledger + enforced settlement +
  aggregate caps + Permit2 AllowanceTransfer, invariants I1–I8, adversarial +
  venue + native/FoT tests, Slither/Echidna/Medusa configs, CI, audit-prep
  package, deterministic deploy script (`d2481a8`…`1157359`).
- **2026-05-31 → 06-01 — Aggregator v1 + verification hardening**: full
  revamp (`82c4c9f`), ABI/pool provenance artifacts, batched reads, request
  coalescing, phase telemetry, read-only one-hop, re-quote before swap build.
- **2026-05-02 → 05-04 — Chain facts + venue research**: chain id, official
  tokens, venue map (Barkswap/MuchFi active; SuchSwap/DogeBox watchlist),
  L1GasPriceOracle, 17-block reorg depth (`4cb2244`…`e33ab7c`).

---

## Appendix — skill-doc fixes that could not be applied (permission-blocked)

### `.claude/skills/dex-aggregation/SKILL.md` (~lines 94-98)

Replace the `isTransientError` description with:

> `isTransientError` precedence (PR #11): explicit `transient===true` /
> AbortError → transient; revert markers (`execution reverted`/`revert`)
> checked FIRST → genuine; then transport patterns (timeout, any
> `HTTP <status>` — the RPC client throws before reading the body, so no
> status carries a venue verdict; fetch/socket/ECONN-class, missing-batch,
> unknown-RPC, batch-shape, `not valid JSON` parse failures) → transient;
> then venue signatures (ABI shape/decode/invalid/exceeds) → genuine;
> unknown text defaults genuine.

(The old text cites HTTP 408/429/5xx and the dead pre-merge hash `a2e828c`.)

### `.claude/skills/trail-of-bits-security/SKILL.md`

- Line ~53: CI install is now pinned — replace
  `Uniswap/permit2` with `Uniswap/permit2@cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`
  and delete the "installs untagged — known reproducibility risk" sentence
  (fixed by PR #4).
- Line ~59: `(currently 11,831 B)` → `(currently 12,683 B)`.

### `packages/contracts/audit/SLITHER_TRIAGE.md` (~line 13)

Residual count is 9, not 11 (stale table row noted in PR #8 review).

### `packages/contracts/audit/REPRODUCIBILITY.md` (permit2 row)

Record the pinned SHA `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` next to the
`@uniswap/permit2 1.0.0` row (adjudicated 2026-07-03, PR #4).
