# Cross-chain architectures — mechanics, trust, and DogeOS availability evidence

All availability claims verified 2026-07-02 unless noted. DogeOS Chikyū = chain 6281971,
Scroll-stack zkEVM settling to **Dogecoin L1** (not Ethereum), testnet-only. That anchor-chain
fact is the recurring disqualifier: nearly every protocol below assumes an Ethereum-anchored
chain and/or a business-development relationship.

## 1. Canonical rollup bridges (background + the DogeOS instance)

**Reference mechanics (Ethereum-anchored rollups):**
- Deposits L1→L2 are fast (minutes): L1 contract locks funds, sequencer must include them.
- Withdrawals L2→L1 are slow because L1 must be convinced the L2 state is valid:
  - *Optimistic (OP Stack)*: initiate on L2 → prove on L1 against a FaultDisputeGame root
    claim → finalize after the ~7-day challenge window (challenges can add +3.5 to +9 days).
  - *zkEVM (validity proofs)*: claimable once a validity proof covering the batch is verified
    on L1 — no challenge window *in principle*, but prover cadence + governance timelocks
    dominate in practice (ZKsync Era historically 21–24 h execution delay, reduced to a 3 h
    minimum by ZIP-4; avg proof interval ~38 min per L2BEAT). "zk = instant withdrawals" is
    false in practice.
- Trust: the rollup's own proof system + upgrade keys (usually a multisig on young chains).
  The canonical bridge is the root of canonical token mappings — every third-party bridge
  ultimately rebalances through it or references its addresses.

**The DogeOS canonical bridge** (https://portal.testnet.dogeos.com/bridge; docs:
https://docs.dogeos.com/en/getting-started/user-guide/bridge — "very early implementation …
specifically for testnet"):
- **DOGE only.** No ERC-20 path exists or is mentioned anywhere in docs.
- Deposit: enter DogeOS address → UI shows a Dogecoin address + an OP_RETURN payload → send
  testnet DOGE including that OP_RETURN **as binary** (helper scripts:
  https://github.com/DogeOS69/dogecoin-tools) → relay to L2 "can take up to 4 hours".
- Withdraw: enter amount + Dogecoin address; the UI displays a **derived Ethereum address
  used internally by the bridge — do not send funds to it**; confirm the transfer tx; relay
  to L1 "can take up to 4 hours".
- No fee schedule documented anywhere; bridge-update costs are socialized into every DogeOS
  tx's Data & Finality fee (`totalTxFee = executionFee + dataAndFinalityFee`, oracle at
  `0x5300000000000000000000000000000000000002` — the same oracle our fee estimator reads,
  `packages/aggregator/src/fees/l1GasPriceOracle.mjs`).
- No proof/operator architecture is disclosed → assume an operated relay. Docs say absolute
  finality only "after a proof and withdrawal fulfillment transactions are completed on
  Dogecoin"; max reorg depth 17 blocks; batch cadence unobservable (Blockscout
  `/api/v2/scroll/batches` → zero items, probed 2026-07-02).
- Observability hooks (probed 2026-07-02): `GET
  https://blockscout.testnet.dogeos.com/api/v2/scroll/withdrawals` returns origination
  records (`id, origination_timestamp, origination_transaction_hash, value,
  completion_transaction_hash`) — ~13,190 records, **all sampled records show
  `completion_transaction_hash: null` including one from 2026-04-30**; completion happens on
  Dogecoin L1 and is not indexable. `/api/v2/scroll/deposits` is empty. Consequence for any
  status poller: withdrawal completion must be observed by polling the target Dogecoin
  address (https://sochain.com/DOGETEST), deposit completion by polling the DogeOS recipient
  balance / incoming tx.
- There is **no canonical Ethereum bridge** for DogeOS. This breaks the structural
  assumptions of Across and most Ethereum-hub protocols (no rebalancing path).

## 2. Circle CCTP (burn-and-mint USDC)

Mechanics: burn native USDC on source; Circle's off-chain **Iris** attestation service signs
the burn message after the requested finality; anyone submits message+attestation to mint on
destination. No pools, no wrapped assets. V2 details: `TokenMessengerV2.depositForBurn`,
`MessageTransmitterV2`, message carries `minFinalityThreshold` (1000 = "confirmed" → Fast
Transfer ~8–20 s, Circle self-insures reorg risk via an over-collateralized Fast Transfer
Allowance; 2000 = "finalized" → Standard, 15–19 min). Fees: Standard 0 bps, Fast 1–14 bps by
source chain, deducted at mint, capped by caller `maxFee`. ~27 domains mid-2026, all with
testnet equivalents. Attestation API: `iris-api(.sandbox).circle.com`.

Trust: Circle is a single trusted attester *and* the issuer (can freeze/blacklist regardless).

**DogeOS availability: NO, and no self-service path.** "Permissionless" in CCTP marketing
means permissionless *use* of deployed contracts; only Circle deploys CCTP and only on chains
where Circle issues native USDC. A Dogecoin-anchored testnet will not get native USDC. All
"USDC"/"USDT" on Chikyū are mocks: `MintableBurnableToken` contracts (USDC
`0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925`, USDT `0xC81800b77D91391Ef03d7868cB81204E753093a9`)
from a single EOA `0x495Ace0212c55B00F8a509562eef3A5C3192B0c9`, 18 decimals where canonical is
6, identical 2.001B minted supplies (Blockscout-verified 2026-07-02). Nothing to integrate.

## 3. LayerZero v2 + OFT

Mechanics: an immutable **Endpoint** contract per chain; per-pathway **Security Stack** of
**DVNs** (X-of-Y-of-N: all required DVNs must sign, plus Y-of-N optional) each independently
verify the message payload hash; an **Executor** (or anyone) commits + executes on the
destination. OFT token standard: burn/mint for new tokens on all chains, or an OFT Adapter
lock/unlock on the home chain; wiring = deploy per chain, `setPeer`, set enforced options,
configure DVNs per pathway. On new/exotic pathways the default config can be a **Dead DVN**
placeholder — messages cannot flow until the OApp sets its own DVNs.

Trust: your chosen DVN set (safety + liveness) + Executor (liveness) + LZ Labs' endpoint
code + the token owner's delegate keys. Defaults ≈ a 2-party multisig including LZ Labs.

**DogeOS availability: NO — effectively no self-service.** Verified 2026-07-02: the canonical
deployments API (`https://metadata.layerzero-api.com/v1/metadata`) has no DogeOS entry.
Endpoints are deployed by LayerZero Labs as protocol administrator; the code is open
(github.com/LayerZero-Labs/LayerZero-v2) but a self-deployed endpoint is not socially
canonical, doesn't connect to the official mesh, and you'd still run your own DVNs on both
sides plus an executor. Realistic path = BD conversation; a small Dogecoin-anchored testnet
is unlikely to be prioritized.

## 4. Hyperlane — the only true self-serve option

Mechanics: per-chain **Mailbox** for send/receive; security is per-app pluggable via
**Interchain Security Modules (ISMs)** on the destination — Multisig ISM (validators sign
Merkle checkpoints of the origin Mailbox's outbound tree), Aggregation, Routing, Optimistic,
CCIP-Read; apps can override the default ISM per recipient.

**Permissionless deploy — YES, DogeOS qualifies** (EVM chain + RPC + chain ID + funded EOA):
1. `hyperlane registry init` → writes `~/.hyperlane/chains/dogeoschikyu/metadata.yaml`
2. `hyperlane core init` && `hyperlane core deploy` → Mailbox, default ISM
   (`trustedRelayerIsm` for testing), merkleTreeHook, protocolFee hook; addresses in
   `addresses.yaml`
3. `hyperlane send message --relay` to smoke-test
4. Run agents: `hyperlane relayer --chains dogeoschikyu,sepolia`
5. For public use: PR to https://github.com/hyperlane-xyz/hyperlane-registry (which, checked
   2026-07-02, contains only the unrelated Polygon-Edge `dogechain` — no DogeOS).

Token bridging = **Warp Routes**: `hyperlane warp init` / `warp deploy`; per-chain config
`type: collateral` (lock existing ERC-20, mint synthetic elsewhere) | `native` | `synthetic` |
`collateralVault`; e.g. USDC-Sepolia (collateral) ↔ USDC.hyp synthetic on DogeOS is
deployable today by one engineer. Note the destination asset is a **synthetic** — it would
not be the mock "USDC" DogeSwap venues pool, so a delivered USDC.hyp still needs a market or
a swap leg to be useful. Plan liquidity before shipping.

Ops you own: **validators** (watch your Mailbox, sign Merkle roots after finality,
self-announce on-chain, publish sigs to S3/local; ~2-core/2GB, ~$75/mo each, keys hex or AWS
KMS, private RPCs recommended) and a **relayer** (aggregates sigs, delivers). On a
self-deployed chain YOU run both.

Trust: exactly what you configure — typically an honest majority of *your own* validator
keys, plus the warp-route upgrade/ownership keys. Integration cost: days of engineering +
ongoing agent ops. **Strategic caveat for DogeSwap**: running validators + relayer makes us a
bridge operator, contradicting the NEAR-Intents spec's non-goal ("We operate no solvers and
no bridges"). Acceptable only as a clearly-labeled experiment; see SKILL.md §5.

## 5. Across — optimistic intent settlement

Mechanics (V3): user deposits into the origin **SpokePool**; a relayer fronts its own capital
on the destination in seconds; the Risk Labs dataworker batches fills into bonded root-bundle
proposals to the **HubPool on Ethereum**; bundles are optimistically valid after a challenge
window (UMA case study: "typically one hour"; disputes go to UMA's DVM vote); validated
bundles repay relayers from LP capital and rebalance across chains **via canonical bridges**.
V4 replaces per-chain adapters with ZK proofs of *Ethereum* state (Succinct SP1: SP1Helios
light client + UniversalSpokePool; ~12–15 min settlement message).

Trust: user fill-risk is seconds; relayers/LPs trust the optimistic oracle
(single-honest-disputer); everything anchors on Ethereum.

**DogeOS availability: NO, structurally.** Chain onboarding runs through Risk Labs/ACX
governance (relayer network, LP support, rebalancing routes required); SP1Helios verifies
Ethereum state — DogeOS settles to Dogecoin and has **no canonical Ethereum bridge** to
rebalance through. Also mainnet-oriented; a testnet with no economic activity won't attract
relayer capital.

## 6. Intent-based cross-chain

Shared model: user signs an intent (desired outcome + deadline); a solver fronts assets on
the destination instantly; a settlement layer later verifies the fill and releases escrowed
origin funds. User exposure is seconds; the hard problem moves to *solver repayment security*.
**ERC-7683** (Uniswap Labs + Across, 2024) standardizes the CrossChainOrder struct +
settlement interface; adopted via the EF's Open Intents Framework (30+ projects, 2025).

- **UniswapX cross-chain**: in production, Uniswap-interface cross-chain swaps settle via
  **Across** — trust model and chain coverage = Across's. No DogeOS path.
- **Relay (relay.link)**: the pragmatic small-chain option; full model in
  [relay-model.md](relay-model.md). Verified 2026-07-02: 72 enabled mainnet chains via
  `GET https://api.relay.link/chains` (incl. many small/exotic L2s — Shape, Gunz, Degen,
  Mythos, MegaETH…), but `api.testnets.relay.link/chains` lists **only Sepolia and Base
  Sepolia**; **DogeOS is not supported**. Onboarding is not self-serve: email
  support@relay.link; marketed as "designed to add chains on Day 1" for coordinated launches.
  Best BD-path option for mainnet era.
- **NEAR Intents (1Click)** — the dormant Sub-project D spec
  (`docs/superpowers/specs/2026-06-06-dogeos-cross-chain-near-intents-spec.md`, approved
  2026-06-06, **zero implementation exists**). Model: request quote → receive a **deposit
  address** → user sends funds → solver delivers to the destination address or
  **auto-refunds** to `refundTo`. ~33 supported chains including **Dogecoin L1** (and 16 EVMs,
  BTC forks, Solana, TON, Tron…); **DogeOS is NOT listed**; new chains added only by the NEAR
  Intents team on request (Telegram `@near_intents`). 0.2% fee unless registered on the
  Partners Portal for a JWT (`NEAR_INTENTS_JWT` in the spec). TypeScript SDK:
  `defuse-protocol/one-click-sdk-typescript`. Trust: 1Click "temporarily transfers assets to
  a trusted swapping agent" — the spec mandates surfacing this, always setting `refundTo`,
  tight `slippageBps`, and a `deadline`.
  **Why it matters despite no DogeOS support**: Dogecoin L1 *is* supported, so composing
  [any supported asset] → intent → DOGE on Dogecoin L1 → canonical bridge → DogeOS (and the
  reverse) delivers DogeOS-native cross-chain **today** with an interim L1 hop — the exact
  Flow 2 of the spec. The hop retires the day DogeOS is listed.

## 7. Chainlink CCIP — live on DogeOS but not yet usable

The ONLY third-party interop protocol with a live DogeOS deployment (verified 2026-07-02 via
https://docs.chain.link/ccip/directory/testnet/chain/dogeos-testnet-chikyu and Chainlink's
Q1-2026 review):
- Chain selector `7254999290874773717` (name `dogeos-testnet-chikyu`; also in
  smartcontractkit/chain-selectors as `DOGEOS_TESTNET_CHIKYU`)
- Router `0x524B83ae8208490151339c626fd0E35b964483e3`; RMN
  `0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0`; TokenAdminRegistry
  `0xEAB080c724587fFC9F2EFF82e36EE4Fb27774959`; TokenPoolFactory
  `0x1D0b2edF6b66845872b6cC82C036E3601Cb2Be57`
- Fee tokens: LINK `0xe5e3a4fF1773d043a387b16Ceb3c91cC49bAFD54` (faucet drips 25 LINK at
  https://faucets.chain.link/dogeos-testnet-chikyu), WDOGE
  `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` (the same WDOGE we route), native DOGE
- **Lanes: ONE, outbound only, DogeOS → Ethereum Sepolia** (OnRamp
  `0xd1CBe8dF481C7a78AaaAfB0466814d13d93bd9b7`, CCIP v1.6.0). No inbound lane shown; the
  directory's "Tokens (1)" doesn't name the token (likely CCIP-BnM, unverified). As listed
  this is one-way messaging out to Sepolia — **do not plan round-trip token transfers on it**.
- Uncertainty: the missing inbound lane could be a directory rendering artifact; the Sepolia
  page was not separately checked. Re-verify before dismissing CCIP.
- Note: our own registry deliberately rejects CCIP routers as a *swap* surface
  (`packages/aggregator/src/sources/intelligence.mjs:54-58`) — correct; it's messaging, not a
  DEX venue.

Watch items: new lanes on the directory page; TokenPoolFactory permissionless token pools;
Chainlink Data Streams listed DogeOS in the 2026-06-28 changelog (pull-based price oracle —
useful for the aggregator's fee/score conversion, unrelated to bridging; stream IDs
unverified).

## 8. Bridge aggregation (LI.FI / Socket style)

Mechanics: aggregate quotes across N third-party bridges + DEXes, return the best composed
route, execute via each bridge's own contracts. Trust: the union of the underlying bridges
you route through (aggregators add routing/API risk but custody nothing extra).

**DogeOS availability: nothing to aggregate.** Every underlying rail (§§2-7) is absent. Bridge
aggregation becomes relevant only at mainnet if/when ≥2 third-party rails exist. The legs[]
schema in [integration-design.md](integration-design.md) is deliberately adapter-pluggable so
DogeSwap *is* the aggregator when that day comes.

## 9. Decision table (verified 2026-07-02)

| Option | Self-service? | Trust | Realistic today for DogeOS Chikyū |
|---|---|---|---|
| Canonical DogeOS bridge | n/a (exists) | Bridge operator (opaque, early) | DOGE only, ≤4 h each way |
| CCTP | No — Circle-only, needs native USDC | Circle attester/issuer | No |
| LayerZero v2/OFT | No — LZ Labs deploys endpoints | Chosen DVN set | No (BD only) |
| **Hyperlane** | **Yes — CLI deploy + warp routes + self-run agents** | Your own validator multisig | **Yes — only true self-serve** |
| Across (V4) | No — governance + Ethereum-anchored | Fillers + UMA | No (structural) |
| UniswapX cross-chain | No (rides Across) | = Across | No |
| Relay | No, but low-friction BD (support@relay.link) | Trusted relayer + oracle | Not yet — best BD path |
| CCIP | No (Chainlink) | Chainlink DON | Deployed but outbound-messaging-only |
| NEAR Intents 1Click | No (listing on request) | Trusted swapping agent + refunds | Via Dogecoin-L1 hop: **yes, today** |
