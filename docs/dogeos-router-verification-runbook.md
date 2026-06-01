# DogeOS Router Verification Runbook

Status baseline: 2026-05-31

Use this runbook before enabling or reviewing executable swaps for any DogeOS DEX source.

## Commands

Run the dependency-free verification script:

```bash
node scripts/verify-dogeos-sources.mjs
```

The command prints machine-readable `tokens`, `sources`, and `summary` sections. It exits nonzero when the DogeOS chain ID is wrong, an expected address-returning relationship read mismatches the registry, or an official token `decimals()` read differs from the committed token registry. Missing Blockscout ABI/source proof is still reported on each source, but active first-pass routers execute through committed `adapter-fragment` ABI artifacts, selector evidence, typed local builders, and runtime `/swap` simulation.

Run its tests:

```bash
node --test scripts/__tests__/verify-dogeos-sources.test.mjs
```

The API exposes verification snapshots through `GET /verification`. Keep that route backed by a cached or injected verifier snapshot in production so `/quote` remains optimized for live routing latency.

Each verified source target now includes an `executionEvidence` object. That object is the concise operator contract for provenance: it states whether the contract is executable, which ABI proof type is present, whether Blockscout ABI/source is available, whether a target-bound adapter or venue artifact is verified, which selectors matched bytecode, how many relationship reads passed, and the Blockscout URLs used for the check. Use this summary for UI/operator display instead of inferring readiness from scattered fields.

## Verification Inputs

For each source, record:

- `sourceId`
- protocol type
- role: router, factory, quoter, pool, or position manager
- contract address
- ABI provenance
- expected router selector for execution
- expected address-returning relationship reads, such as `factory()`, `WETH()`, `WETH9()`, and `poolDeployer()`
- Blockscout URL
- Blockscout smart-contract URL
- Blockscout smart-contract ABI availability: `blockscoutContract.hasAbi`
- Blockscout direct ABI endpoint URL and response: `blockscoutAbiEndpointUrl`, `blockscoutAbi.status`, `blockscoutAbi.message`, and `blockscoutAbi.abiFunctionSignatures`
- adapter ABI fragment or venue ABI artifact metadata, when Blockscout ABI/source verification is unavailable
- official-token `decimals()` read result for WDOGE, LBTC, WETH, USD1, USDC, and USDT
- last checked block or timestamp

## Router Checks

1. Confirm DogeOS RPC returns chain ID `0x5fdaf3`.
2. Read router bytecode with `eth_getCode`.
3. Confirm Blockscout reports `is_contract: true`.
4. Query both `/api/v2/smart-contracts/{address}` and `/api?module=contract&action=getabi&address={address}`. Treat either parsed ABI payload as Blockscout ABI evidence, and preserve direct `getabi` status/message in `/verification` and `/venues`.
5. Confirm the committed `adapter-fragment` artifact is target-bound to the exact DogeOS router address, chain ID, selector list, and function signatures. For strict audit mode, confirm Blockscout reports `is_verified: true` and `blockscoutContract.hasAbi: true`, or commit a venue-authorized ABI artifact.
6. Confirm any adapter, Blockscout, or venue ABI payload contains every expected router function signature recorded in the source registry. ABI availability without function-signature matches is insufficient.
7. Treat `onchain-bytecode` as selector evidence only. It is not enough by itself for live router verification.
8. Check expected swap selectors, such as `exactInputSingle`.
9. Run expected router relationship reads and confirm returned addresses match the registry:
   - MuchFi V2 router: `factory()` and `WETH()`
   - MuchFi V3 router/quoter: `factory()` and `WETH9()`
   - Barkswap router/quoter: `factory()` and `poolDeployer()`
10. Treat any relationship-read mismatch as a verification failure that blocks CI and active execution.
11. Build representative calldata from the verified ABI.
12. Run `eth_call` against the exact transaction request with a concrete sender.
13. Run `eth_estimateGas` against the same request.
14. Confirm the source registry status is `active` only after all checks pass.

## Factory And Pool Checks

1. Confirm factory bytecode exists.
2. Confirm pool discovery method works at a specific block.
3. Confirm pool token addresses match the token registry.
4. Confirm token decimals are read on-chain.
5. Capture pool state needed for quote math:
   - V2: reserves and token ordering
   - V3: `slot0`, liquidity, fee tier, token ordering
   - Algebra-style: `globalState`, liquidity, fee, token ordering
6. Store pool address and Blockscout links in the source registry.

## Token Checks

1. Read bytecode at every official token address in `packages/config/src/tokens.mjs`.
2. Call `decimals()` with selector `0x313ce567`.
3. Confirm each on-chain result matches the committed registry. Current DogeOS official tokens are 18-decimal assets, including USDC and USDT.
4. Treat missing bytecode, failed `decimals()` reads, or decimal mismatches as verifier failures.

## ABI Provenance Levels

| Level | Execution allowed | Description |
| --- | --- | --- |
| `none` | No | Address discovered, but ABI source is unknown. |
| `onchain-bytecode` | No by itself | Selector evidence from deployed bytecode; useful for pools and discovery, but routers need ABI provenance before active verification. |
| `adapter-fragment` | Active after live verification | Aggregator-owned ABI fragment for a typed builder, target-bound to source ID, DogeOS chain ID, role, router/quoter address, selectors, function signatures, and recomputed artifact hash. |
| `venue-artifact` | Active after full verification | Venue supplied ABI artifact with verified metadata, source URI, recomputed 32-byte artifact hash, target-bound router address, selector matches, relationship reads, and passed simulation. |
| `partner-artifact` | No | Legacy naming; use `venue-artifact` instead. |
| `official-docs` | Simulation only by default | ABI/address published in official venue docs, but the explorer ABI/source is still missing. |
| `blockscout` | Active after tests | Contract source and ABI payload are verified on Blockscout, and the ABI payload contains the expected router function signatures. |

## Verified Calldata Builders

Typed calldata builders exist for the current first-pass venue set and are behind source-status, router-match, ABI-provenance, selector, and runtime simulation checks:

| Source | Method | Selector | Encoded safety fields |
| --- | --- | --- | --- |
| MuchFi V2 | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `0x38ed1739` | amount in, min amount out, path, recipient, deadline |
| MuchFi V3 | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `0x04e45aaf` | token in, token out, fee tier, recipient, amount in, min amount out, price limit |
| Barkswap Algebra | `exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))` | `0x1679c792` | token in, token out, deployer sentinel, recipient, deadline, amount in, min amount out, price limit |

Current calldata builders make MuchFi V2, MuchFi V3, and Barkswap Algebra executable when the selected quote is active. They still remove arbitrary calldata from the wallet path.

## Runtime Swap Verification

The live `/venues` path exposes the committed source contract map as execution provenance. It groups router, factory, quoter, position-manager, pool-deployer, and pool addresses by source, then overlays Blockscout ABI availability, bytecode, selector matches, relationship-read results, and `executionEvidence` from the latest verification snapshot.

The live `/approval` path must verify DogeOS chain ID, derive the spender from the selected route router, read ERC-20 `allowance(owner, router)`, and return an approval transaction only when the selected exact-input `amountIn` or exact-output `maxAmountIn` is not already covered.

The live `/swap` path must verify DogeOS chain ID, build calldata through the verified typed builder, run `eth_call`, run `eth_estimateGas`, resolve DogeOS data/finality fee from the exact calldata through `L1GasPriceOracle.getL1Fee(bytes)`, check ERC-20 `balanceOf(sender)` and native DOGE `eth_getBalance`, and return a buffered gas limit before the web app asks the wallet to sign. A source that cannot pass this runtime simulation and balance preflight stays below `active`, even when quote reads work.

The web app must submit swaps with the connected wallet as `sender`. Do not simulate or send active swaps with a zero address or a recipient-only fallback.

The live `/quote` path must return timing telemetry with total quote latency, pre-quote verification latency, candidate-provider latency, fee-resolution latency, route-scoring latency, candidate count, executable candidate count, and rejected candidate count. Use that data to track p50/p95 route speed and to identify slow venues before enabling execution.

## Emergency Disable

1. Change the affected source status in `packages/aggregator/src/sources/registry.mjs` to `disabled`.
2. Keep its address records and verification notes in place for auditability.
3. Run `npm test` and `npm run verify:sources`.
4. Restart or redeploy the API/web process that serves `/sources` and `/quote`.
5. Confirm `/sources` reports the source as `disabled`.
6. Confirm `/quote` no longer returns active or read-only candidates from that source.
7. Record the disable reason, timestamp, and operator in the incident log or release notes.

## Current Live Snapshot

The 2026-05-31 live verification run showed:

| Source | Address | Role | Result |
| --- | --- | --- | --- |
| MuchFi V3 | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | router | Bytecode exists, `adapter-fragment` ABI artifact is verified, `0x04e45aaf` selector appears, and `factory()`/`WETH9()` match the registry; source status is `active` with runtime swap simulation. |
| MuchFi V3 | `0x5DE1Ea595653419f295511DEb781b98387a77cc2` | quoter | Bytecode exists, QuoterV2 selector `0xc6a5026a` returns live official-token quotes, and `factory()`/`WETH9()` match the registry. |
| MuchFi V3 | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | factory | Bytecode exists and `poolDeployer()` matches the registry; not execution-capable by itself. |
| MuchFi V2 | `0xC653e745FC613a03D156DACB924AE8e9148B18dc` | router | Bytecode exists, `adapter-fragment` ABI artifact is verified, V2 swap selectors are present, and `factory()`/`WETH()` match the registry; source status is `active` with runtime swap simulation. |
| MuchFi V2 | `0x7864071B532894216e3C045a74814EafEB92ae20` | factory | Bytecode exists, not execution-capable by itself. |
| Barkswap | `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` | router | Bytecode exists, `adapter-fragment` ABI artifact is verified, `0x1679c792` selector appears, and `factory()`/`poolDeployer()` match the registry; source status is `active` with runtime swap simulation. |
| Barkswap | `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D` | quoter | Bytecode exists, Algebra quoter selector `0xe94764c4` returns live official-token quotes, and `factory()`/`poolDeployer()` match the registry. |
| Barkswap | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | factory | Bytecode exists and `poolDeployer()` matches the registry; not execution-capable by itself. |
| Barkswap | `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | factory | Bytecode exists, not execution-capable by itself. |

## Enablement Rule

Do not mark a source `active` until router address, ABI provenance, bytecode, source verification, selector checks, deterministic quote tests, exact calldata building, runtime swap simulation, gas estimation, balance preflight, emergency disable support, and monitoring are all complete.
