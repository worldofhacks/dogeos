---
name: cross-chain-swaps
description: Design and build cross-chain swaps / bridge integration for DogeSwap on DogeOS Chikyū testnet (chain 6281971). Use when asked to "add a bridge route", implement a "cross-chain swap", plan a "bridge integration", extend the API with a "multi-leg quote", "swap from Ethereum/Dogecoin to DogeOS", debug "why is my bridge deposit stuck", or evaluate bridges (Relay, Hyperlane, CCTP, LayerZero, CCIP, NEAR Intents) for DogeOS.
---

# Cross-chain swaps for DogeSwap

**Current state (verified 2026-07-02): ZERO cross-chain implementation exists in this repo.**
The only artifacts are (a) a dormant, approved-but-unbuilt NEAR-Intents spec at
`docs/superpowers/specs/2026-06-06-dogeos-cross-chain-near-intents-spec.md` (Sub-project D,
dated 2026-06-06 — no `packages/crosschain/`, no 1Click client, no code anywhere), and
(b) CCIP routers listed as a *rejected surface* in
`packages/aggregator/src/sources/intelligence.mjs:54-58` ("cross-chain messaging, not
same-chain spot swaps"). The roadmap (`.claude/.roadmap`, section "Next") holds
"Cross-chain swaps, phase 0 — design doc + multi-leg quote schema behind a flag". Everything
below is design knowledge to implement from, not a description of shipped code.

Read next, depending on the task:
- [references/architectures.md](references/architectures.md) — full mechanics + trust model +
  DogeOS-availability evidence for every architecture (canonical bridges, CCTP, LayerZero,
  Hyperlane, Across, CCIP, intent-based). Read when choosing/justifying an architecture.
- [references/relay-model.md](references/relay-model.md) — the relayer-fill model in depth
  (Relay's API, order lifecycle, refund semantics). Read before designing our own
  order-status machine or pitching Relay for DogeOS support.
- [references/integration-design.md](references/integration-design.md) — the concrete repo
  design: endpoint contracts, full legs[] schema JSON, order store, poller, frontend flow,
  failure matrix. Read when actually implementing.

## 1. DogeOS constraints — verified ground truth (2026-07-02)

DogeOS Chikyū is a **testnet-only** zkEVM (Scroll stack) that settles to **Dogecoin L1, not
Ethereum** — this single fact disqualifies most Ethereum-anchored interop. Chain 6281971, RPC
`https://rpc.testnet.dogeos.com`, explorer `https://blockscout.testnet.dogeos.com`
(constants in `packages/config/src/chains.mjs`). Native DOGE is 18 dec on L2, 8 dec on L1.

**Canonical bridge** (`https://portal.testnet.dogeos.com/bridge`, docs call it "a very early
implementation"): DOGE only, no ERC-20 support of any kind, no documented fee schedule.
- *Deposit (Dogecoin Testnet → DogeOS)*: user enters a DogeOS address, the portal shows a
  Dogecoin address + an **OP_RETURN payload that must be included as binary** in the L1 send
  (helper: https://github.com/DogeOS69/dogecoin-tools). Relay to L2 "can take up to 4 hours".
- *Withdraw (DogeOS → Dogecoin Testnet)*: portal shows a **derived Ethereum address used
  internally — funds sent to it directly are lost**; user confirms a transfer tx; relay to L1
  "up to 4 hours".
- *Observability*: `GET /api/v2/scroll/withdrawals` on Blockscout lists withdrawal
  originations (~13,190 as of 2026-07-02) but `completion_transaction_hash` is **null even on
  months-old records** (completion happens on Dogecoin L1, not indexable) — never use it to
  infer relay success; poll the L1 address via https://sochain.com/DOGETEST instead.
  `/api/v2/scroll/deposits` is empty (deposits enter via OP_RETURN, not an L1 contract).

**Finality**: documented max reorg depth **17 blocks** (surfaced in our `/chain-status` as
`documentedMaxReorgDepth`); absolute finality only after proofs land on Dogecoin. Batch/proof
cadence is undocumented AND unobservable (`/api/v2/scroll/batches` returns zero items) —
treat time-to-finality as unknown; the only protocol-published latency number anywhere is the
bridge's "up to 4 hours". Block time ~3 s.

**Third-party interop — what was checked and the result (all 2026-07-02):**
- **Chainlink CCIP: the ONLY third party live on DogeOS.** Directory entry
  `dogeos-testnet-chikyu`, chain selector `7254999290874773717`, Router
  `0x524B83ae8208490151339c626fd0E35b964483e3`, fee tokens LINK
  `0xe5e3a4fF1773d043a387b16Ceb3c91cC49bAFD54` / WDOGE / native DOGE. **But: one outbound
  lane only (DogeOS → Ethereum Sepolia), no inbound lane shown, the one listed token is
  unnamed** — effectively one-way messaging out, not usable for round-trip token transfers
  today. Watch https://docs.chain.link/ccip/directory/testnet/chain/dogeos-testnet-chikyu for
  new lanes; TokenPoolFactory `0x1D0b2edF6b66845872b6cC82C036E3601Cb2Be57` enables
  permissionless token pools if lanes appear.
- **LayerZero: NO** (no DogeOS entry in `metadata.layerzero-api.com/v1/metadata`).
  **Hyperlane: NO deployment** (registry has only the unrelated `dogechain`) — but Hyperlane
  is self-deployable, see §2. **Wormhole: NO. Axelar: NO. CCTP: NO** (Circle-only; no native
  USDC on DogeOS, ever, until Circle decides). **Relay: NO** (`api.testnets.relay.link/chains`
  lists only Sepolia + Base Sepolia; 72 mainnet chains, no DogeOS).
- **All DogeOS "stablecoins" are mocks**: USDT/USDC/USD1/WETH/LBTC are the same
  `MintableBurnableToken` from one EOA `0x495Ace0212c55B00F8a509562eef3A5C3192B0c9`, all
  18 decimals (canonical USDC/USDT are 6). Only WDOGE
  `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` has a real L1 backing path. Consequence: a
  "swap USDC from Ethereum to DogeOS" request **cannot deliver real USDC** — any inbound
  stable becomes either a synthetic (Hyperlane warp) or a swap into mock-token liquidity.
  Be explicit about this in any user-facing copy and any plan.

## 2. Architecture options (summary — evidence in references/architectures.md)

| Architecture | Mechanism (one line) | Trust | Integration cost | Available for DogeOS today? |
|---|---|---|---|---|
| Bridge aggregation (LI.FI/Socket-style) | Quote N third-party bridges, present best | Each underlying bridge | Low per bridge | **No — there are zero third-party bridges to aggregate** |
| Relayer fill (Relay) | User deposits to origin Depository; solver fronts destination asset in seconds; oracle attests, solver repaid | Relay Inc.'s oracle/relayer (deposit protected by non-upgradable Depository) | Low (REST) | **No** — not on their chain list; onboarding = BD email to support@relay.link, explicitly marketed at new chains |
| Relayer fill (Across) | Same fronting idea; repayment via UMA optimistic oracle on Ethereum HubPool | Fillers + UMA + Ethereum anchoring | Medium | **No, structurally** — V4's SP1Helios verifies *Ethereum* state; DogeOS settles to Dogecoin, no canonical ETH bridge to rebalance through |
| Burn-and-mint: CCTP | Burn native USDC, Circle attests, mint on dest | Circle (attester + issuer) | Low where live | **No, no self-serve path** — needs Circle-issued USDC |
| Canonical messaging: LayerZero OFT | Endpoint + DVN quorum verifies message; OFT burn/mint | Chosen DVN set + LZ Labs endpoints | Medium | **No** — endpoints deployed only by LZ Labs; self-deploy is non-canonical + needs own DVNs both sides |
| Canonical messaging: Hyperlane | Mailbox per chain; pluggable ISM (your validator multisig); warp routes lock/mint tokens | **Your own validator keys** | Days of eng + ongoing ops (1-3 validators + relayer, ~$75/mo/box) | **YES — the only true self-serve.** `hyperlane core deploy` on DogeOS + a Sepolia↔DogeOS warp route is doable by one engineer |
| Canonical messaging: CCIP | Chainlink DON verifies; lanes per pair | Chainlink DON | Low where lanes exist | **Partially live but unusable** — outbound-to-Sepolia messaging only (§1) |
| Intent-based: UniswapX cross-chain | ERC-7683 orders, settled via Across | = Across | — | **No** (rides Across) |
| Intent-based: NEAR Intents (1Click) | Quote → deposit address → solver delivers or auto-refunds | "Trusted swapping agent" + refund path | Low (REST/SDK, dormant spec exists) | **DogeOS: no; Dogecoin L1: YES** — so a DOGE corridor works today via an interim L1 hop (bridge DOGE L2↔L1 canonically, run the intent from/to Dogecoin L1) |
| Canonical DogeOS bridge (orchestrated) | Guide the user through OP_RETURN deposit / portal withdrawal; we track legs | Bridge operator (opaque, early) | Medium (pure off-chain orchestration) | **YES — exists today, DOGE only, ≤4h/leg** |

**Bottom line**: the only corridors implementable *unilaterally today* are (1) DOGE via the
canonical bridge, orchestrated off-chain, optionally composed with a local DogeSwap swap leg;
(2) a self-deployed Hyperlane Sepolia↔DogeOS warp route — with the caveat that we would then
*be* a bridge operator (our validator keys = the bridge), which contradicts the NEAR-Intents
spec's stated non-goal "we operate no solvers and no bridges". Surface that tension in any
plan that picks Hyperlane. NEAR Intents adds arbitrary-asset reach on ~33 chains but always
terminates at Dogecoin L1, requiring the canonical hop for DogeOS-native delivery.

## 3. Recommended integration design (what to build)

Full contracts/schemas/code sketches: [references/integration-design.md](references/integration-design.md).
Design principles: **architecture-agnostic multi-leg schema** (bridge adapters are pluggable,
like quote providers), **non-custodial** (every tx user-signed; server only quotes, tracks,
and guides), **feature-flagged** (`CROSSCHAIN_ENABLED` env, following the
`DOGESWAP_ROUTER_ADDRESS`/`DOGESWAP_ROUTER_MODE` pattern read in `packages/api/src/live.mjs:175-180`).

**New endpoints** (added in `packages/api/src/handler.mjs` after `/swap` at :921-982; both
must also be added to the `API_PATHS` allowlist in `packages/web/src/server.mjs:20-34` or the
prod web server will treat them as static-file requests):
- `POST /crosschain/quote` — `{fromChainId, toChainId, sellToken, buyToken, amountIn,
  slippageBps, sender, recipient}` → a quote whose `best` route has `routeType:"crosschain"`
  and `legs[]`. Returns 404 when the flag is off; `status:"unavailable"` reuses the existing
  transient semantics (handler.mjs:851-861).
- `POST /crosschain/order` — freezes an accepted quote into a tracked order; returns
  `{orderId, legs, instructions}` (instructions = e.g. the OP_RETURN payload + deposit
  address for a canonical-bridge leg).
- `GET /crosschain/status?id=<orderId>` — per-leg live status. **Use a query param, not a
  path param**: every existing route is an exact `url.pathname ===` match (handler.mjs:612-982)
  and `API_PATHS` is an exact-match Set; `?id=` matches the established `/token?address=` /
  `/activity?address=` style with zero router surgery.

**Multi-leg schema** — extend, don't replace, the existing candidate shape. Precedent: split
candidates already carry `legs[]` (`packages/aggregator/src/routes/splitRoutes.mjs:86-115`,
`composeSplitCandidate`: `{sourceId, protocolType, poolAddress, amountIn, amountOut,
gasUnits, ...}`). Cross-chain legs add three things same-chain legs never needed:
**per-leg `chainId`**, **per-leg `kind`** (`"swap" | "bridge" | "fill"`), and **per-leg
lifecycle `status`** (`pending → awaiting-user → submitted → confirmed | failed | refunded |
delayed`), because a cross-chain route is *not atomic* — each leg is a separate user action
or external relay. `routeType:"crosschain"`, `sourceId:"crosschain-<adapter>"`,
`status:"read-only"` in phase 0 (exactly how one-hop previews ship today,
`routes/oneHop.mjs:44-46`) so nothing is executable until an adapter is promoted.

**New aggregator module** `packages/aggregator/src/crosschain/` (mirrors the provider style):
- `quoteProvider.mjs` — composes legs: destination swap legs re-enter the existing direct
  composite provider (same trick as `routes/oneHop.mjs:72` re-entering "direct"); bridge legs
  come from an adapter interface `{quoteBridgeLeg, buildInstructions, pollLegStatus}`.
- `adapters/canonicalDoge.mjs` (phase 1), `adapters/nearIntents.mjs` (phase 2, implements the
  dormant spec's 1Click client), `adapters/hyperlaneWarp.mjs` / `adapters/relay.mjs` (stubs).
- `orderStore.mjs` — **the first stateful feature in an otherwise stateless server.** JSON
  file-backed (path from `CROSSCHAIN_ORDER_STORE` env) with in-memory map; the
  `createCreatorReputation` `onChange` persistence hook pattern
  (`discovery/creatorReputation.mjs`) is the in-repo precedent. Orders must survive restarts —
  a bridge leg outlives any process (4 h relay vs. systemd redeploys).
- `statusPoller.mjs` — per-leg polling: DogeOS legs via Blockscout
  `/api/v2/transactions/{hash}`; Sepolia legs via that chain's explorer API; Dogecoin L1 legs
  via sochain address polling (no completion event exists — see §1). Give every fetch an
  AbortSignal timeout (open roadmap item #10 exists precisely because current Blockscout
  fetches don't).

**Wiring**: `packages/api/src/live.mjs` builds the crosschain providers only when
`CROSSCHAIN_ENABLED=1` and injects them into `createAggregatorApiHandler` like every other
provider (handler.mjs is testable without RPC; live.mjs is the only file knowing upstreams).

**Frontend flow** (`apps/web/src/ui/`): `SwapFlow.jsx` + `useSwapExecution.js` today model a
single-chain `approve → swap` lifecycle with `phase` strings from `lib/execute.js`. Cross-chain
adds a stepper: *source-chain approval/deposit → bridge/fill wait → destination swap*, one card
per leg with its own status pill, explorer link, and ETA ("bridge relays can take up to 4 hours
on testnet"). New `ui/CrosschainProgress.jsx`; extend `lib/api.js` with
`getCrosschainQuote/createCrosschainOrder/getCrosschainStatus`; the tracker must be
**resumable** — persist `orderId` in localStorage and re-hydrate from `/crosschain/status` on
reload (the spec's orchestrator requirement).

**/activity surfacing**: the server `/activity` endpoint is a stateless single-chain
Blockscout proxy (handler.mjs:768-798) — cross-chain legs can never come from it. Surface via
the existing LOCAL stream instead: `logSwapActivity` (`apps/web/src/lib/execute.js:595`)
writes `localStorage('doge.history')` entries which `ActivityView.jsx` merges with chain data;
extend the entry shape with `legs[]` + `orderId` and render a multi-row "cross-chain" card
where each leg links to *its own* chain's explorer. Server-side, completed orders in the
order store can later back a `GET /crosschain/activity?address=` if needed.

## 4. Failure handling (full matrix in references/integration-design.md §5)

Non-negotiables, per architecture:
- **Canonical bridge**: "up to 4 h" is *normal*, not stuck. Policy: leg shows `submitted`
  with an ETA until 4 h, flips to `delayed` (amber, "testnet relays can exceed the documented
  4-hour window; funds are not lost") until a hard 12 h review threshold — never auto-mark
  `failed` (there is no failure signal to observe; see §1 observability). Two irreversible
  user errors to *prevent, not handle*: deposit sent without/with malformed OP_RETURN (funds
  unrecoverable — always render the exact payload with a copy button and a "sent from an
  exchange?" warning, exchanges strip OP_RETURN), and sending funds to the withdrawal UI's
  derived Ethereum address.
- **Relayer fill (Relay model)**: refunds are near-instant *on the origin chain* when a fill
  can't happen, but **only if `refundTo` was set** — make refund address mandatory in our
  order schema no matter the adapter. Terminal `refund` vs `failure` (refund < gas ⇒ no
  refund) must be distinct statuses and distinct copy.
- **NEAR Intents (1Click)**: statuses pending/processing/success/refunded/failed with
  auto-refund to `refundTo`; always set tight `slippageBps` + `deadline`; surface the
  "temporarily transfers assets to a trusted swapping agent" trust note in the confirm UI.
- **Hyperlane (self-run)**: a stuck message = *our* relayer/validator is down; retry is
  redelivery (idempotent), an ops alert, not a user problem — but user copy must still show
  `delayed`.
- **Partial completion** (the defining cross-chain failure): bridge leg succeeded, destination
  swap leg failed/expired → user holds the bridged asset on the destination chain. This is a
  *resumable success*, not a failure: the remaining leg is an ordinary same-chain `/quote` +
  `/swap`. Mark the order `partial`, offer "finish the swap" re-quoting fresh (never replay a
  stale quote — the fail-closed re-quote discipline of `clampRefreshedSwapQuote`,
  handler.mjs:349-381, applies doubly here). Refund the *user's intent*, never custody a
  correction.
- Every leg status maps 1:1 to an activity row state: `awaiting-user` → "action needed",
  `submitted` → "in progress" + ETA, `delayed` → amber, `confirmed` → green + explorer link,
  `refunded` → "refunded to <origin chain>", `partial` → "1 of 2 legs done — finish swap".

## 5. Security model comparison & what's acceptable here

| Option | You trust | Blast radius on failure | Verdict for this product |
|---|---|---|---|
| Canonical DogeOS bridge | Opaque operator ("very early implementation") | User's DOGE in relay limbo; OP_RETURN mistakes = loss | **Acceptable, unavoidable** — it's the chain's own bridge; testnet stakes; we only orchestrate |
| NEAR Intents 1Click | Trusted swapping agent + refund machinery | Deposited amount until refund | **Acceptable with disclosure** — non-custodial for *us*, refund path exists, spec already mandates surfacing the trust note |
| Relay | Relay Inc. oracle/relayer set (Depository protects deposits) | Deposit until fast-refund | **Acceptable at testnet/mainnet** — but unavailable; BD item |
| Hyperlane self-deployed | **Our own 1-3 validator keys + our relayer uptime** | Everything in the warp route's collateral | **Acceptable only as a clearly-labeled experiment** — we become the bridge; contradicts the "no bridges operated" non-goal; never default-route user funds through it; revisit at mainnet with external validators |
| CCIP | Chainlink DON | Lane funds | Acceptable when usable — today it isn't (outbound-only) |
| LayerZero / CCTP / Across | (n/a) | — | Moot — no DogeOS path; mainnet-era BD items only |

Product posture: DogeSwap is a **non-custodial aggregator** — the server builds and verifies,
users sign everything (`/swap` binds recipient to sender, handler.mjs:72-85). Cross-chain must
keep that: we never hold keys, run no solver capital, and prefer architectures where user
funds are protected by contract (Depository/escrow) or by refund paths over architectures
where *we* are the security (Hyperlane). Testnet-today means the real risk is *UX and copy*
(irreversible OP_RETURN mistakes) more than economic attack; mainnet-later means every trust
choice made now should be re-underwritable (swap the adapter, keep the legs[] schema).

## 6. Staged plan (matches `.claude/.roadmap` "Next")

- **Phase 0 (now)** — `docs/cross-chain-design.md` (the design doc this skill describes) +
  the `legs[]` schema landed behind `CROSSCHAIN_ENABLED` with `status:"read-only"` candidates
  only; `POST /crosschain/quote` returns priced-but-not-executable multi-leg previews for the
  DOGE corridor. No orders, no state. Tests: schema + provider composition with mocked adapters.
- **Phase 1 (single-corridor MVP)** — DOGE, Dogecoin Testnet L1 ↔ DogeOS via the canonical
  bridge, *guided*: order store + `/crosschain/order` + `/crosschain/status` + resumable
  frontend stepper + OP_RETURN payload rendering + sochain/Blockscout polling; optional
  destination swap leg reusing `/quote`+`/swap`. End-to-end testnet dry-run with recorded tx
  evidence (the repo's verification style), both directions.
- **Phase 2 (reach)** — activate the dormant NEAR-Intents spec: 1Click client
  (`adapters/nearIntents.mjs`), arbitrary-asset ↔ Dogecoin-L1 ↔ DogeOS composed corridor;
  file the DogeOS listing request with the NEAR Intents team (Telegram `@near_intents`).
  Optionally: Hyperlane Sepolia↔DogeOS warp-route pilot as a labeled experiment (decision
  gate: are we willing to operate a bridge?).
- **Phase 3 (mainnet-era BD)** — pitch Relay (support@relay.link) and watch the CCIP
  directory for inbound lanes; retire the L1 hop the day DogeOS is listed anywhere; re-run
  the §5 trust table against mainnet stakes before enabling any corridor by default.
