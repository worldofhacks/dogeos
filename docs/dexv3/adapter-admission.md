# DogeOS DEX Adapter Admission

## Required Before Quote Support

1. Source has a stable `sourceId`.
2. Factory and pool addresses are known.
3. Token decimals are read on-chain.
4. Pool state can be read at a specific block.
5. Quote math is tested against on-chain pool state.
6. Source status is visible through the source registry.

## Required Before Execution Support

1. Router address is confirmed.
2. Quoter or execution ABI is confirmed, or the adapter directly executes against a verified canonical pair interface.
3. Source or ABI provenance is verified through Blockscout, official docs, or signed partner artifact.
4. Adapter has fork or testnet tests for exact-input swaps.
5. Router enforces adapter allowlist, min-out, deadline, recipient, and pause.
6. Execution source is marked `active`; unverified sources remain `readOnly` or `watchlist`.
7. No source may execute arbitrary user-provided calldata.

## DogeOS-Specific Checks

1. Route scoring includes execution gas and data/finality fee.
2. Quote contains block number and TTL.
3. Indexer or analytics code handles a 17-block reorg buffer.
4. Native DOGE and WDOGE behavior is tested.
5. Official token decimals are not hard-coded from Ethereum mainnet assumptions.

## Current Implementation Status

| Source ID | Adapter | Status | Execution gate |
| --- | --- | --- | --- |
| `muchfi-v2` | `DogeOSV2PairAdapter` | Active for dust-size testnet execution after Chikyu deployment, Blockscout source verification, adapter allowlisting, route preflight, and live canary swap | Keep as the only executable source until broader canary coverage and monitoring exist. |
| `muchfi-v3` | none | Read-only | Requires router/quoter ABI provenance and adapter implementation. |
| `barkswap-algebra` | none | Read-only | Requires canonical router/quoter confirmation and adapter implementation. |
