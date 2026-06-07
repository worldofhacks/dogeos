# DogeSwap Cross-Chain via NEAR Intents — Sub-project D Spec

Date: 2026-06-06
Status: Approved (brainstorming → ready for implementation plan); built in parallel with A.
Part of: `2026-06-06-dogeos-premium-aggregator-v2-program.md`

## Objective

Add cross-chain swaps to the DogeOS aggregator using **NEAR Intents** via its **1Click API**,
entirely **off-chain** (no router contract changes). Because DogeOS is not a NEAR-Intents
supported chain, DogeOS-native cross-chain is delivered now through an **interim Dogecoin-L1
canonical-bridge hop**; a DogeOS listing request runs alongside to retire the hop later. The
general supported-chain ↔ supported-chain cross-chain flow is also delivered.

## External constraints (load-bearing facts — verify before/while building)

- **Supported chains (~33):** 16 EVM (Arbitrum, ADI, Aurora, Base, Bera, BNB, Ethereum,
  Gnosis, Optimism, Plasma, Polygon, Avalanche, Monad, XLayer, Scroll), 6 BTC-forks
  (Bitcoin, **Dogecoin**, Zcash, Bitcoin Cash, Litecoin, Dash), 11 L1s (Aleo, Aptos, Cardano,
  NEAR, Solana, Stellar, Sui, TON, Tron, XRP, Starknet). **DogeOS (chain `6281971`) is NOT
  listed.** New chains are added only by the NEAR Intents team on request (Telegram
  `@near_intents`); no self-serve onboarding.
- **1Click model:** request quote → receive a **deposit address** → user sends funds to it →
  solver delivers to the destination address, or **auto-refunds** to a refund address. SDKs:
  TypeScript (`defuse-protocol/one-click-sdk-typescript`), Go, Rust. A **0.2% fee** applies
  unless registered on the **Partners Portal** for a JWT; fee is also configurable per quote.
- **DogeOS canonical bridge:** DogeOS L2 ↔ Dogecoin L1. Deposit = send testnet DOGE to a
  bridge-provided Dogecoin address with OP_RETURN data; once confirmed, funds are relayed to
  the DogeOS wallet. Withdraw = the reverse. Early testnet implementation.
- Verify the exact 1Click endpoints, field names, auth, and Dogecoin/testnet sandbox support
  during implementation (the public docs index is thin; the SDK and quickstart are the source
  of truth).

## Architecture

### Off-chain 1Click client

A new module (e.g. `packages/crosschain/src/oneClick.mjs`, mirroring the repo's existing
provider/composition style) wrapping the 1Click API:

- `getQuote({ originAsset, destinationAsset, amount, recipient, refundTo, slippageBps, deadline, feeBps })`
- `getDepositAddress(quote)` (or returned with the quote)
- `submitDeposit({ quoteId, depositTxHash })`
- `getStatus(quoteId)` → pending / processing / success / refunded / failed
- `handleRefund(quoteId)` surfacing the refund destination/state

Auth via a Partners Portal JWT from env (`NEAR_INTENTS_JWT`), to avoid the 0.2% fee and to set
the app's own fee parameter. All calls go through the existing `fetchFn` injection pattern so
they are testable with mocks.

### Two flows

**Flow 1 — Supported-chain ↔ supported-chain (general).** User holds an asset on a supported
chain → `getQuote` → user deposits to the deposit address from that chain → poll status →
solver delivers on the destination chain. DogeOS is not involved.

**Flow 2 — DogeOS-native via the interim Dogecoin-L1 hop (the headline).**

- **Outbound (DogeOS → other chain):**
  1. (Optional) Swap the user's DogeOS token → DOGE/WDOGE locally via the Sub-project A router.
  2. Withdraw DOGE through the DogeOS canonical bridge to the user's **Dogecoin L1** address.
  3. From Dogecoin L1, `getQuote` to the destination asset/chain and deposit the L1 DOGE to the
     1Click deposit address.
  4. Solver delivers on the destination chain; poll status; show refund if it fails.
- **Inbound (other chain → DogeOS):**
  1. `getQuote` with destination = DOGE delivered to the user's **Dogecoin L1** address; user
     deposits the source asset.
  2. Bridge the delivered L1 DOGE into DogeOS via the canonical bridge.
  3. (Optional) Swap DOGE → target DogeOS token via the router.

The orchestrator tracks each leg (router receipt → bridge tx → L1 deposit/intent id → intent
status) and is **resumable** (persist deposit addresses, tx hashes, quote ids).

### Role of the router (Sub-project A)

Only `SWEEP`-to-recipient, used for the optional local DogeOS swap leg. In the interim hop the
1Click deposit address lives on **Dogecoin L1** (post-bridge), so the router never sends
directly to a 1Click address. (Once DogeOS is listed, the router's `SWEEP` could send straight
to a DogeOS 1Click deposit address, collapsing the hop.) No contract changes either way.

## Trust & safety

- 1Click "temporarily transfers assets to a trusted swapping agent" — surface this trust
  assumption to users; always set `refundTo`, tight `slippageBps`, and a `deadline`.
- Canonical-bridge trust + latency + irreversibility — show clear status, ETA, and warnings.
- We custody nothing; every step is user-signed/user-sent. The orchestrator only coordinates
  and tracks.

## UX (integrates into Sub-project C)

- A resumable multi-leg progress tracker (each leg with state + Blockscout/explorer links).
- Plain-language messaging for the slow Dogecoin-L1 hop ("this route bridges via Dogecoin and
  can take N minutes").
- Refund visibility and recovery guidance.
- An aggregated quote showing **total cost across all legs** (router fee + bridge + 1Click fee
  + price impact) so the user sees true all-in pricing.

## Testing

- Unit tests for the 1Click client with a mocked `fetchFn` (quote, deposit, status, refund,
  fee/JWT handling, error/timeout paths).
- Orchestrator tests for leg sequencing, persistence, and resume-after-interruption.
- Integration tests against the 1Click sandbox/testnet if available.
- Canonical-bridge interaction tests (mock + a testnet dry-run).
- An end-to-end testnet dry-run of the outbound and inbound DOGE hop, with recorded evidence
  (tx hashes, intent ids) in the repo's verification style.

## Dependencies & risks

- 1Click API availability and Dogecoin/testnet sandbox support.
- DogeOS canonical-bridge reliability and latency on testnet.
- The DogeOS listing request (to remove the interim hop later) is outside our control.

## Acceptance criteria

- 1Click client integrated: quote, deposit-address, status, refund, fee/JWT.
- Flow 1 (supported-chain cross-chain) works end-to-end.
- Flow 2 (DogeOS-native DOGE, outbound and inbound) demonstrated on testnet with recorded
  evidence.
- The orchestrator tracks and resumes multi-leg flows; refunds are visible and explained.
- Quotes show true all-in cost across legs.
- A DogeOS listing request has been filed with the NEAR Intents team.

## Non-goals

- We operate no solvers and no bridges; no custom bridge is built.
- No arbitrary-token cross-chain in the interim hop (DOGE-focused; arbitrary tokens via
  supported-chain Flow 1 only).
- No on-chain cross-chain logic in the router (see the router spec).
- No attempt to bypass NEAR Intents chain support (we request a listing, we do not fake one).

## Spec self-review

- No placeholders; the unverified API specifics (exact endpoints/fields) are explicitly called
  out as implementation-time verification against the SDK, not left as silent assumptions.
- Consistent with the program roadmap and the router spec (cross-chain stays off-chain).
- Scoped to a single implementation plan (1Click client + orchestrator + interim hop + UX
  hooks), with the DogeOS-listing dependency tracked as external.
- Ambiguity resolved: build now, including the interim Dogecoin-L1 hop; router untouched.
