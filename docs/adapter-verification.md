# DogeOS Adapter Verification

Status baseline: 2026-05-31

This checklist controls when an external DogeOS liquidity venue can move from discovery to live quotes and executable swaps. It is not a recurring approval process: once a source is verified, execution relies on live source status, ABI provenance, router match, typed calldata selectors, pinned pool token/state proof, sender-aware simulation, gas estimation, and balance preflight.

## Source Statuses

| Status | Meaning |
| --- | --- |
| `watchlist` | Candidate found, but not trusted for quotes. |
| `readOnly` | Pool, factory, or verified quoter reads are useful, but no executable swap transaction is returned. |
| `simulationOnly` | Calldata can be built and simulated internally, but users cannot execute it yet. |
| `active` | Venue has a verified router address, ABI provenance, selector evidence, matching relationship reads, typed calldata builders, and runtime swap simulation before wallet signing. |
| `disabled` | Venue is intentionally excluded. |

## Required Before Read-Only Quotes

1. Stable `sourceId`.
2. Protocol family classified as `v2`, `v3`, `algebra`, or `custom`.
3. Factory or pool addresses identified.
4. Token addresses and decimals read from chain.
5. Pool state readable at a specific block, with `token0` and `token1` matching the committed source registry.
6. Quote math backed by deterministic fixtures.
7. Source status visible through the public source registry.

Concentrated-liquidity sources must not invent exact-input quotes from partial pool state. V3 and Algebra adapters can normalize a quoter result only after the quoter address, selector, factory relationship, and ABI provenance are recorded.

## Required Before Active Execution

1. Router bytecode exists on DogeOS RPC.
2. ABI provenance is recorded. Current live venues execute with committed `adapter-fragment` ABI artifacts plus typed local builders; Blockscout ABI/source or a venue-authorized ABI artifact remains the preferred provenance upgrade. Blockscout checks read both `/api/v2/smart-contracts/{address}` and `/api?module=contract&action=getabi&address={address}` so the app can show direct ABI endpoint status and message per contract.
3. The expected router function signature is encoded in the local typed builder. If Blockscout or venue artifacts are used, `hasAbi: true` alone is not enough; the ABI must contain the expected function.
4. Factory, router, quoter, position manager, and pool addresses are mapped where applicable.
5. Address-returning relationship reads match the registry, such as `factory()`, `WETH()`, `WETH9()`, and `poolDeployer()`.
6. Pinned pool contracts pass `poolStateCheck`: V2 pairs return expected `token0`, `token1`, and `getReserves()`; V3 pools return expected `token0`, `token1`, `slot0()`, and `liquidity()`; Algebra pools return expected `token0`, `token1`, `globalState()`, and `liquidity()`.
7. Exact-input quote-vs-simulation tests pass.
8. `/swap` verifies the DogeOS chain ID before returning an executable transaction.
9. `/swap` builds calldata through a typed builder, runs `eth_call`, runs `eth_estimateGas`, resolves DogeOS data/finality fee for the exact calldata, and checks balances before the wallet signs.
10. Execution path enforces min-out and deadline.
11. Source can be disabled without redeploying the whole platform.
12. Monitoring tracks quote latency, source/provider issues from `/quote.telemetry.sourceErrors`, revert rate, stale quote rate, and gas estimate delta.
13. Blockscout links are shown for router, pool, token, and transaction records.

## Venue ABI Artifact Requirements

Current `adapter-fragment` artifacts live in `packages/aggregator/src/abi/adapterAbiArtifacts.mjs`. They are not venue endorsements; they are the aggregator's minimal ABI fragments for the typed builders. Live verification treats them as executable only when the artifact target, selector list, function signatures, recomputed artifact hash, router bytecode selectors, and on-chain relationship reads all match.

Use `abiProvenance: "venue-artifact"` only when Blockscout source/ABI verification is unavailable but the venue provides a specific ABI artifact for the deployed router. The artifact must be committed with:

1. `status: "verified"`.
2. Venue issuer name.
3. Source URI for the ABI artifact.
4. 32-byte `artifactHash` that recomputes from the committed artifact payload.
5. Target binding: source ID, DogeOS chain ID, `role: "router"`, and router address.
6. Selector matches for every swap method.
7. Matching on-chain bytecode selectors.
8. Matching relationship reads.
9. Passed sender-aware `eth_call`, `eth_estimateGas`, data/finality fee, allowance, and balance preflight evidence.

Selector-only bytecode, unsigned ABI snippets, broad docs, or artifacts not bound to the exact router address stay below `active`.

To create the committed artifact wrapper from a venue-provided ABI JSON file, run:

```bash
npm run create:venue-abi -- \
  --source-id muchfi-v3 \
  --role router \
  --address 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB \
  --issuer MuchFi \
  --source-uri https://venue.example/dogeos/router.json \
  --selectors 0x04e45aaf,0x5023b4df \
  --abi ./router.json
```

The command accepts a raw JSON ABI array, an object with an `abi` array, or a Blockscout `getabi` response. It emits a `venue-artifact` object with derived canonical function signatures and a recomputed hash. After committing the artifact into the matching registry target, `npm run verify:sources` must still prove bytecode, selectors, relationship reads, pool state, and token metadata against DogeOS RPC and Blockscout.

## Automatic Rejection Conditions

- Missing bytecode.
- Unknown ABI provenance.
- Selector-only `onchain-bytecode` router evidence at the executable calldata boundary.
- Missing router, quoter, factory, or pool address from the `/venues` contract map.
- Missing expected router function in a Blockscout or venue ABI payload when that provenance mode is used.
- Missing sender-aware runtime simulation before wallet signing.
- Mismatched factory, wrapped DOGE, or pool-deployer relationship read.
- Mismatched pinned pool `token0`/`token1`, failed pool state read, or stale pool address.
- Arbitrary calldata.
- Hidden recipient changes.
- Route output not protected by min-out.
- No deadline.
- No concrete sender for allowance-aware simulation.
- Approval transaction not derived from the selected quote router and exact required sell-token amount.
- Insufficient sell-token balance for exact-input `amountIn` or exact-output `maxAmountIn`.
- Insufficient native DOGE balance for transaction value, buffered gas, and data/finality fee.
- Token decimals assumed from another chain.
- Source cannot be disabled independently.

## DogeOS-Specific Checks

1. Chain ID is `6281971` / `0x5fdaf3`.
2. DOGE fee display separates execution fee and data/finality fee.
3. Data/finality fee is resolved per route through the live fee-provider boundary; the default provider uses `L1GasPriceOracle.getL1Fee(bytes)` at `0x5300000000000000000000000000000000000002`.
4. Active `/swap` verification re-reads the same oracle with the exact calldata returned to the wallet.
5. Quote responses include block number and expiry.
6. Indexer and analytics tolerate the documented 17-block reorg depth.
7. Native DOGE and WDOGE wrapping behavior is explicit.
