# Repository audit — 2026-06-11 (multi-agent run)

Read-only, evidence-based audit of this repository produced by an orchestrated multi-agent workflow (run `wf_b8f5ee5a-b9d`):

1. **Map** — 3 agents mapped frontend, backend, and contracts/ops → [repo-map.md](repo-map.md)
2. **Audit** — one principal-auditor agent per dimension produced findings with `file:line` citations
3. **Verify** — every finding was handed to an independent adversarial verifier agent instructed to *refute* it by re-reading the cited code; only findings that survived are listed as confirmed
4. **Gaps** — a completeness critic looked for areas the audit missed and spawned extra finders

Run stats: 84 agents (76 completed), ~34 min, 4.4M tokens, 1339 tool calls. The run was stopped early to conserve usage; incompleteness is noted below.

## Confirmed-finding severity totals

| Critical | High | Medium | Low |
| --- | --- | --- | --- |
| 0 | 4 | 31 | 26 |

## Reports by dimension

| Dimension | Result |
| --- | --- |
| [Architecture & design](findings/architecture.md) | 8 confirmed / 0 refuted |
| [Trading/quoting correctness (core money paths)](findings/trading-correctness.md) | 7 confirmed / 0 refuted |
| [Code quality — backend](findings/code-quality-backend.md) | 8 confirmed / 0 refuted |
| [Code quality — frontend](findings/code-quality-frontend.md) | 8 confirmed / 0 refuted |
| [Security — backend/API](findings/security-backend.md) | 4 confirmed / 0 refuted |
| [Security — Solidity contracts](findings/security-contracts.md) | 6 confirmed / 0 refuted |
| [Testing](findings/testing.md) | 7 confirmed / 0 refuted |
| [Dependencies, DevEx & operations](findings/deps-devex-ops.md) | 8 confirmed / 0 refuted |
| [Documentation accuracy](findings/docs.md) | 5 confirmed / 0 refuted |
| [Gap sweep (critic round)](findings/gap-sweep.md) | 5 unverified findings |

## Top confirmed findings (High and above)

- **[High]** /swap silently re-quotes and rebases minAmountOut to the refresh-time price, so the on-chain slippage floor can be arbitrarily below the user-displayed 'min received' — `packages/api/src/handler.mjs:292-335 (refreshSwapQuote` ([trading-correctness](findings/trading-correctness.md))
- **[High]** Barkswap Algebra quoter result decoding contradicts the project's own 'verified' ABI artifact; failure mode is silent venue death or a wrong exact-output price — `packages/aggregator/src/discovery/concentratedLiquidityPools.mjs:213-227` ([trading-correctness](findings/trading-correctness.md))
- **[High]** Components defined inside SwapView's render body remount the amount input on every keystroke — `apps/web/src/ui/SwapView.jsx:226 (Chip)` ([code-quality-frontend](findings/code-quality-frontend.md))
- **[High]** useWallet has no initial-state seeding; tab switches remount views into a 'disconnected' state where connect silently no-ops — `apps/web/src/ui/useWallet.js:117-141 (no seeding) and :173 (silent early return); remount trigger at apps/web/src/ui/Shell.jsx:200 and :293` ([code-quality-frontend](findings/code-quality-frontend.md))

## Completeness-critic: areas flagged for follow-up

- **Unbounded in-memory cache growth in the data-finality fee provider, keyed by full per-swap calldata (memory leak / unauthenticated memory DoS on the long-running server)** — No existing finding covers server in-memory state growth. packages/aggregator/src/fees/l1GasPriceOracle.mjs:65 creates a module-closure `const cache = new Map()` whose TTL (15s) is only consulted on read — entries are NEVER evicted and there is no size cap. packages/api/src/live.mjs:166-171 wires a second instance of this provider for the swap path with `payloadProvider: ({ transaction }) => transaction.data`, and verifySwapTx.mjs (lines 51-83) invokes it once per POST /swap with the freshly built router calldata. Because every swap's calldata is unique (amounts + a wall-clock deadline are encoded), every /swap request permanently inserts a new ~500-1000-char string key plus a record into the Map of the single long-running production process (packages/web/src/server.mjs). This is both a slow leak under normal use and a cheap unauthenticated memory-DoS: POST /swap with varied amounts grows server memory without bound. The existing DoS finding covers request fan-out/body size, and the verificationSnapshot finding covers thundering herd — neither covers unbounded retained state. Secondary issue in the same function: the catch at lines 91-94 silently returns fallbackFeeWei=0n (live.mjs passes no onProviderError), so oracle failures silently zero the data-finality fee used in route scoring and verification.
- **Zero HTTP security headers on the wallet-connected production frontend: no Content-Security-Policy, no frame-ancestors/X-Frame-Options (clickjacking), no X-Content-Type-Options, no Referrer-Policy** — Despite a security-frontend-wallet audit dimension, no finding mentions response security headers. Verified by grep: neither packages/web/src/server.mjs (static file responses at lines 119-134 set only cache-control and content-type), nor packages/api/src/handler.mjs (JSON_HEADERS at lines 11-16), nor apps/web/src/index.html (no meta CSP) set any of CSP, X-Frame-Options, frame-ancestors, nosniff, or Referrer-Policy. For a DEX UI that connects wallets and prompts eth_sendTransaction, a missing frame-ancestors policy enables classic clickjacking overlay attacks on the swap-confirm button, and the absence of CSP removes all defense-in-depth against any injected script rewriting the recipient/calldata shown to the user. index.html also loads Google Fonts cross-origin and the app vendors a 26MB third-party charting library, so a CSP would be the containment layer. This is a standard Medium for wallet dApps and is entirely untouched by the existing findings (which cover CORS *, error echo, request limits — all different).
- **Chart subsystem data integrity (apps/web/src/lib/chartDatafeed.js): synthetic per-device OHLC presented in a TradingView chart, localStorage series keyed by token SYMBOL (cross-token collision), per-resolution divergent histories, and a second always-on 10s /quote poller per open chart** — No finding touches chartDatafeed.js or ChartView's data behavior (only its modal markup duplication was cited). The datafeed fabricates OHLC bars from periodic /quote probes of a fixed 1-token size and persists them per browser in localStorage — so the 'chart' is device-local probe history, not market data, and users make trade decisions off it. Concrete checkable defects: storageKey (lines 43-47) uses `sellToken?.symbol ?? address`, so two different token contracts sharing a symbol (or the '?' fallback when metadata is missing) silently merge price series across tokens; each resolution accumulates an independent series so the 1m and 1h charts of the same pair show contradictory histories; bar 'continuity' opens new buckets at the previous close even after days offline, splicing stale prices into fresh bars; the probe price embeds venue fee + depth for exactly 1 token (a size-dependent execution quote, not a mid price); and subscribeBars (lines 252-294) starts an extra 10s POST /quote interval per open chart on top of useQuote's poll — a client-side multiplier on the already-flagged /quote RPC fan-out that the DoS finding did not count.

## What is missing from this audit (run stopped early)

- The **security-frontend-wallet** and **performance** dimension auditors errored and produced no report.
- The gap-sweep findings in [findings/gap-sweep.md](findings/gap-sweep.md) were **not adversarially verified**.
- One gap-sweep finder (chart subsystem data integrity) and 5 verifiers were still running when the workflow was stopped.
- The synthesis phases (improvement strategy + milestone task plan) were not generated; the raw verified findings here are the input for that.
