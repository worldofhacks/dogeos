# Relay (relay.link) — the relayer-fill model in depth

Why this file exists: Relay is (a) the most realistic third-party rail for DogeOS at mainnet
(BD path, routinely onboards small/new EVM chains), and (b) the best-documented reference
design for the order/status/refund machinery we must build ourselves in
`packages/aggregator/src/crosschain/` regardless of which adapter ships first. Facts verified
2026-07-02 against live API + docs.relay.link unless noted.

## The model in one paragraph

User asks for a quote; the API returns a **solver commitment** (a specific solver address,
price, deadlines). The user deposits into a non-upgradable **Depository** contract on the
origin chain — *not* to the solver — with an `orderId` tying the deposit to the commitment.
The solver detects the deposit and fills on the destination chain **from its own inventory**
(transfer, swap output, or arbitrary calls) in seconds — no cross-chain message is on the
user's critical path. Settlement (solver repayment) happens afterwards: oracle validators
verify deposit-matches-fill, sign an EIP-712 attestation, and the solver redeems it on the
dedicated **Relay Chain** hub ledger, per-order, in real time (~$0.005/order, no batching
window). Solvers withdraw accrued balances on any chain on their own cadence via an MPC
**Allocator** (on Aurora/NEAR) that the Depositories trust.

Key property to copy: **the user's risk window is seconds and the user's funds are protected
by contract** (Depository escrow + refund path), while all verification latency is pushed onto
the solver's repayment path.

## Lifecycle and statuses (the template for our order store)

Poll `GET /intents/status/v3?requestId=...` at ~1 Hz (websocket also available):

```
waiting      awaiting deposit confirmation
depositing   origin deposit confirmed via /execute, pending fill
pending      deposit confirmed, pending destination submission
submitted    destination tx sent
success      terminal
delayed      fill delayed, still processing (NOT terminal)
refund       terminal — successfully refunded
failure      terminal — unsuccessful fill AND no refund issued
```

Response carries `{status, details, inTxHashes[], txHashes[], updatedAt, originChainId,
destinationChainId}`. Note the tri-state ending: `success` / `refund` / `failure` are
distinct, and `delayed` exists precisely so integrators don't misreport slow as dead — our
canonical-bridge poller needs the same distinction (a 3 h relay is `delayed`, not `failure`).

## Refund semantics (adopt these rules verbatim)

- If the solver can't fill (revert, insufficient deposit, wrong signer vs quote, destination
  outage, malformed/duplicate orderId, requote below `minimumAmount` tolerance), the solver
  refunds **on the origin chain** to the quote's `refundTo`, near-instantly and
  automatically. The refund itself is oracle-attested and credited to the solver like a fill.
- **If `refundTo` is unset, automatic refunds are disabled.** Always require it. (Our order
  schema makes `refundAddress` mandatory for every adapter for this reason.)
- Refund currency ≈ what the Depository actually received (post-origin-swap currency for
  origin swaps). Refund amount is net of refund gas and origin-swap slippage. **If refund <
  gas cost, no refund is issued and the request is `failure`.**
- Order refunds may be specified on BOTH origin and destination chains as fallback paths
  (observed in the live order structure).
- Dev hook: `"referrer": "debug-force-refund"` in the quote forces the refund path — build an
  equivalent test hook into our adapters.
- Deposit-address flow warning: don't set `refundTo` = depositor when funds come from a CEX
  (that address is the exchange hot wallet).

## API surface (what a Relay adapter would call)

Base `https://api.relay.link`, testnets `https://api.testnets.relay.link`.

- `POST /quote/v2` — request `{user, originChainId, destinationChainId, originCurrency,
  destinationCurrency (0x0 = native), amount (smallest unit, string), tradeType: EXACT_INPUT
  | EXACT_OUTPUT | EXPECTED_OUTPUT}` + optional `recipient, refundTo, slippageTolerance (bps
  string), appFees[{recipient,fee}], useDepositAddress, strict, txs[] (arbitrary destination
  calls)`; header `x-api-key` optional.
- Response: `steps[]` (each `{id: deposit|approve|authorize|swap|send, kind:
  transaction|signature, items[{data: tx fields or sign payload, check: {endpoint, method}}]}`
  — iterate, send/sign, poll `check.endpoint` until terminal), `fees` (gas / relayer /
  relayerService ≈ $0.02 flat / app), `details` (`currencyIn/Out`, `minimumAmount` slippage
  floor, `expandedPriceImpact` — use this for fee display, not the deprecated `fees`,
  `timeEstimate` seconds, `rate`), `protocol.v2` full order data (`orderId`, solver address,
  `inputs[].refunds[]`, `output.payments[]/calls[]/deadline` — observed deadlines ≈ 7-8 days).
- `GET /price` — lightweight quote without calldata (analogous to our `/quote` vs `/swap`
  split).
- `GET /chains` — per-chain `{id, depositEnabled, tokenSupport, currency, featuredTokens,
  withdrawalFee, depositFee}`; `GET /chains/liquidity` — solver liquidity per currency (a
  preflight for large transfers; we'd mirror this with a corridor-capacity check).
- `POST /execute` — gasless (EIP-7702) execution variant.
- Deposit addresses (`useDepositAddress: true`): counterfactual per-request address; user
  just transfers (works from CEX withdrawals). `strict: true` binds one order, single-use,
  requires `refundTo`, EXACT_OUTPUT only. Only per-chain "solver currencies" are accepted —
  **non-solver tokens sent there are unrecoverable**. Directly relevant precedent: the NEAR
  Intents 1Click flow is also deposit-address-based, and the canonical DogeOS bridge deposit
  is effectively a deposit-address + OP_RETURN flow — same UX hazards, same mitigations
  (render exact instructions, warn about exchanges, poll for arrival).
- Quote errors worth mapping into our error taxonomy: `AMOUNT_TOO_LOW, CHAIN_DISABLED,
  INSUFFICIENT_LIQUIDITY, NO_QUOTES, ROUTE_TEMPORARILY_RESTRICTED (transient — retry),
  REQUEST_TIMED_OUT / RPC_HTTP_ERROR (transient), SWAP_IMPACT_TOO_HIGH,
  SANCTIONED_CURRENCY/WALLET_ADDRESS`; unexpected terminal: `DESTINATION_TX_FAILED,
  PERMIT_FAILED, UNKNOWN_ERROR`. The transient/genuine split matches our
  `sourceQuoteRunner.mjs` classification philosophy — reuse it.

## Fees

(1) Execution: $0.02 flat + destination fill gas (observed live: a 0.01 ETH Sepolia→Base
Sepolia bridge cost ~$0.021 total, rate 0.99877). (2) Swap fees: DEX fees/slippage +
rebalancing pass-through. (3) Relay fee bps: bridge 0.00%, stable swap 0.01%, major 0.06%,
minor 0.15%. (4) App fees: integrator-set via `appFees`, claimable in stablecoins — this is
the monetization hook an aggregator like us would use.

## Trust model, honestly

Paradigm classifies Relay as the "trusted relayer" flavor of intent bridging. Concretely you
trust: the **oracle validator set** (composition, threshold, and decentralization are NOT
documented) + the **MPC Allocator** + in practice possibly a single dominant solver
(historically Reservoir itself; v1 sent deposits straight to the relayer). Mitigations that
exist: non-upgradable Depositories (user deposits never sit with the solver), audits
(Spearbit 2025-02, Certora 2025-06 Depository, Zellic 2025-11 full settlement). Third-party
claims of solver bonding/slashing are NOT in official docs — treat as unverified.

Contrast with Across: Across repays relayers via UMA-optimistic bundle settlement
(~1 h challenge window, 1-of-N honest disputer, LP pools, Ethereum-anchored); Relay settles
per-order in real time via threshold attestations on its own chain (committee trust, no
challenge window, solver balance sheets). Both give the user a seconds-long risk window; they
differ in who guards solver repayment.

## DogeOS reality and the BD pitch

Verified 2026-07-02: `GET https://api.relay.link/chains` → 72 enabled mainnet chains
(marketing says 85+; delta unverified), including many chains smaller than a successful
DogeOS mainnet would be (Gunz, Degen, Rari, Animechain, Doma…). Testnets endpoint lists
**only Sepolia and Base Sepolia** — and Relay explicitly discourages testnet swap testing
(thin DEX liquidity). **No DogeOS entry of any kind.**

Onboarding is case-by-case via support@relay.link — no self-serve pipeline, no published
prerequisites. What Relay would need to do: deploy a Depository on DogeOS, add solver support
+ DOGE-side liquidity. What strengthens the pitch: DogeOS mainnet launch (Relay markets
"Day 1" chain additions for coordinated launches), demonstrated swap volume, and our
aggregator as the integration surface. Until then, nothing is integrable unilaterally — which
is why phase 1 builds the canonical-bridge corridor and the legs[] schema Relay would later
slot into as just another adapter (`packages/aggregator/src/crosschain/adapters/relay.mjs`).
