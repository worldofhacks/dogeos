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
6. Execution source is marked `active` with `executionSupport: "enabled"`; quote-only sources remain `quoteActive` with `executionSupport: "disabled"`.
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
| `muchfi-v3` | none | Quote-active | Enabled for aggregator quote/pool discovery using on-chain pool reads. Execution requires a verified adapter, explicit allowlist, route preflight, and live canary evidence. |
| `barkswap-algebra` | none | Quote-active | Enabled for aggregator quote/pool discovery using on-chain pool reads. Execution requires a verified adapter, explicit allowlist, route preflight, and live canary evidence. |

## Local Security Automation

| Command | Purpose |
| --- | --- |
| `pnpm security:registry` | Enforces registry admission: MuchFi V3 and Barkswap are quote-active, and only MuchFi V2 is executable. |
| `pnpm security:live-evidence` | Validates deployed router, adapter, allowlist, route preflight, canary swap, and CLAMM quote-source on-chain evidence. |
| `pnpm security:oss` | Records local availability for Slither, Aderyn, OSV Scanner, and Semgrep without adding package dependencies. |
| `pnpm security:local` | Runs the local security suite: secret scan, dependency audit, registry gate, live evidence gate, and open-source tooling inventory. |
