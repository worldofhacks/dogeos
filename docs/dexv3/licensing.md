# DogeOS DEX V3 Licensing Decision

## Decision

The project owner must choose one path before PancakeSwap V3 code is vendored:

- `GPL_APPROVED`: PancakeSwap V3 GPL-2.0-or-later code can be forked with notices preserved.
- `GPL_REJECTED`: PancakeSwap V3 code remains reference-only and the owned CLAMM is disabled until a non-GPL path is approved.

Current implementation status: `GPL_REJECTED` for V1 foundation work. No PancakeSwap V3 source is vendored, and `owned-pancake-v3` remains disabled until an explicit later approval changes this file.

## Approved Source Rules

1. Preserve upstream copyright notices.
2. Preserve upstream SPDX identifiers.
3. Keep forked code under `contracts/vendor/`.
4. Keep DogeOS-native router and aggregator code outside `contracts/vendor/`.
5. Document every copied dependency in this file before merging it.
6. Do not copy BUSL, GPL-3, unclear-provenance, or proprietary code without a separate project-owner decision.

## Dependency Inventory

| Dependency | Use | License | Status |
| --- | --- | --- | --- |
| PancakeSwap V3 contracts | Owned CLAMM baseline if approved | GPL-2.0-or-later | Not vendored; disabled for V1 foundation |
| Uniswap V3 contracts | Reference and lineage check | GPL/BUSL history | Reference only |
| Algebra Integral | Barkswap adapter reference | BUSL-1.1 in researched sources | Reference only |
| OKX DEX Router EVM V1 | Aggregator/router design reference | MIT | Reference only |
| Odos Router V2 | Route design reference | Repository license review required before copying | Reference only |
| ParaSwap DexLib | Adapter design reference | GPL-3 in public repo history | Reference only |
