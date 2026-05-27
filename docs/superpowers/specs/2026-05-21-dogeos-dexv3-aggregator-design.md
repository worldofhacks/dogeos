# DogeOS DEX V3 Fork And Aggregator Design Spec

Status: validated execution baseline
Date: 2026-05-21
Scope: DogeOS owned V3 DEX fork selection, aggregator source selection, DogeOS-specific constraints, risk gates, and implementation acceptance criteria.

## Decision

Build a DogeOS-native, 1inch-style aggregator and an owned concentrated-liquidity DEX source, but do not clone a general-purpose aggregator wholesale.

The owned DEX V1 baseline should be PancakeSwap V3 only if the project explicitly accepts GPL-2.0-or-later obligations and preserves upstream license notices. The current DogeOS owned-DEX doc says to use permissively licensed AMM code or code we own, so a GPL fork is a deliberate licensing-policy change, not a default continuation of the existing docs.

If GPL is accepted, keep PancakeSwap V3 core/periphery behavior as close to upstream as practical. Do not port the core CLAMM math from Solidity 0.7.6 to Solidity 0.8.30 for V1, because that creates a new unaudited CLAMM rather than a conservative fork. DogeOS-specific router, adapter, registry, and quote-service code should be written separately in modern Solidity and TypeScript.

If GPL is not accepted, do not fork PancakeSwap V3. The fallback path is aggregator-first with read-only external venue support, while the owned CLAMM path is resolved through commercial licensing, a clean-room implementation, or a later owned codebase.

## Sources Used

Local repo sources:

- [DogeOS DEX aggregator architecture](../../dogeos-dex-aggregator-architecture.md)
- [DogeOS testnet DEX map](../../dogeos-testnet-dex-map.md)
- [DogeOS testnet liquidity discovery](../../dogeos-testnet-liquidity-discovery.md)
- [Monetization and owned DEX strategy](../../monetization-and-owned-dex-strategy.md)
- [DEX aggregator competitive analysis](../../dex-aggregator-competitive-analysis.md)
- [DogeOS Chikyū testnet](../../dogeos-chikyu-testnet.md)

External research sources:

- Solidity Agent Kit: https://github.com/0xlayerghost/solidity-agent-kit
- PancakeSwap V3 contracts: https://github.com/pancakeswap/pancake-v3-contracts
- PancakeSwap V3 core package metadata: https://raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/projects/v3-core/package.json
- PancakeSwap V3 periphery package metadata: https://raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/projects/v3-periphery/package.json
- PancakeSwap V3 pool source: https://github.com/pancakeswap/pancake-v3-contracts/blob/main/projects/v3-core/contracts/PancakeV3Pool.sol
- PancakeSwap V3 swap router source: https://github.com/pancakeswap/pancake-v3-contracts/blob/main/projects/v3-periphery/contracts/SwapRouter.sol
- PancakeSwap audits: https://docs.pancakeswap.finance/readme/audits
- PancakeSwap V3 deployment docs: https://docs.pancakeswap.finance/to-delete/smart-contracts/pancakeswap-exchange/v3-contracts
- Uniswap V3 licensing: https://support.uniswap.org/hc/en-us/articles/14569783029645-Uniswap-v3-licensing
- Uniswap V3 core license file: https://github.com/Uniswap/v3-core/blob/main/LICENSE
- Uniswap V3 audits: https://developers.uniswap.org/docs/protocols/v3/audits
- Algebra Integral docs: https://docs.algebra.finance/algebra-integral-documentation/algebra-integral-technical-reference/integration-process/migration-from-uniswapv3
- Algebra contracts: https://github.com/cryptoalgebra/Algebra
- Velodrome Slipstream contracts: https://github.com/velodrome-finance/slipstream
- OKX DEX Router EVM V1: https://github.com/okxlabs/DEX-Router-EVM-V1
- Odos Router V2: https://github.com/odos-xyz/odos-router-v2
- KyberSwap Elastic postmortem: https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/

## Validation Pass

Validation performed on 2026-05-21 from this repository and primary upstream sources.

| Check | Result | Evidence |
| --- | --- | --- |
| Repo structure | The repo is currently documentation-only; implementation directories such as `contracts/` and `packages/` do not exist yet. | `rg --files` lists only `docs/` plus local `.tmp/` research artifacts. |
| Current DogeOS RPC | `eth_chainId` returned `6281971`; latest observed block during validation was `5059879`. | Live `https://rpc.testnet.dogeos.com` read with `ethers`. |
| `L1GasPriceOracle` | `0x5300000000000000000000000000000000000002` has bytecode present. | Live RPC bytecode read. |
| Official testnet tokens | WDOGE, LBTC, WETH, USD1, USDC, and USDT still have bytecode and all returned `18` decimals. | Live ERC-20 metadata reads from addresses in `docs/dogeos-chikyu-testnet.md`. |
| DogeOS docs | Official docs still list Chikyū RPC, chain ID `6281971`, DOGE native currency, Blockscout explorer, Prague target, and Solidity `0.8.30`. | DogeOS developer quickstart. |
| DogeOS fee model | Official docs still define total fee as execution fee plus Data and Finality fee, with `getL1Fee(bytes)` exposed by the predeploy. | DogeOS transaction fee docs. |
| DogeOS EVM differences | Official docs still document disabled `SELFDESTRUCT`, unsupported precompile limits, `PREVRANDAO` returning `0`, `COINBASE` returning the fee vault, and 17-block reorg depth. | DogeOS Ethereum differences docs. |
| PancakeSwap V3 license | `@pancakeswap/v3-core` and `@pancakeswap/v3-periphery` package metadata currently declare `GPL-2.0-or-later`; pool and swap router sources also carry GPL SPDX headers and Solidity `=0.7.6`. | PancakeSwap V3 repository package metadata and source headers. |
| PancakeSwap V3 audits | PancakeSwap docs list Exchange V3 audits by PeckShield and SlowMist from March 2023. | PancakeSwap audit docs. |
| Uniswap V3 license lineage | Uniswap V3 core license changed to GPL-2.0-or-later on the earlier of 2023-04-01 or the ENS date, while the repository still retains BUSL license text and per-file license details. | Uniswap V3 license file and Uniswap Labs licensing article. |
| Uniswap V3 audit lineage | Uniswap docs list ABDK core/periphery reviews and a Trail of Bits core review. | Uniswap V3 audit docs. |

## DogeOS Constraints To Carry Into Implementation

| Constraint | Required implementation impact |
| --- | --- |
| Chain ID `6281971` / `0x5fdaf3` | Treat DogeOS as a first-class chain in config, tests, deployment scripts, quote service, and UI. |
| Native gas token is DOGE with 18 decimals | Quote and display gas in DOGE; distinguish native DOGE, WDOGE, and Dogecoin L1 DOGE. |
| Official testnet tokens are 18 decimals | Read token decimals on-chain and store verification snapshots; do not use Ethereum USDC/USDT 6-decimal assumptions. |
| Prague and Solidity `>=0.8.30` are recommended for DogeOS-native contracts | Use modern Solidity for new router/adapters; isolate legacy forked CLAMM contracts if Pancake V3 is selected. |
| `SELFDESTRUCT` disabled; some precompiles unsupported; `PREVRANDAO` returns `0`; `COINBASE` returns fee vault | Router and adapters must avoid randomness, coinbase assumptions, unsupported precompiles, and destruct-based patterns. |
| Data/finality fee exists through `L1GasPriceOracle` at `0x5300000000000000000000000000000000000002` | Net route scoring must include execution gas plus DogeOS data/finality fee, including calldata-size sensitivity. |
| Reorg depth is documented as up to 17 blocks | Indexer, analytics, and quote freshness checks need a 17-block canonicality buffer. |
| Blockscout is the validated explorer | Verification, source links, transaction links, and support workflows should use Blockscout first. |
| Current external DEX router/quoter contracts are not fully verified | Execution must not be enabled for an external venue until router/quoter/periphery addresses and ABIs are confirmed or verified. |

## Owned V3 DEX Baseline Evaluation

| Candidate | License posture | Technical fit | Decision |
| --- | --- | --- | --- |
| PancakeSwap V3 | GPL-2.0-or-later in pool sources inspected during research | Close Uniswap V3 derivative, supports fee-tier model including `2500`, operationally familiar | Preferred fork if GPL is approved. |
| Uniswap V3 canonical | BUSL changed to GPL after license change date, but core is the original audited model | Safest conceptual lineage, older compiler, stronger copyleft/license diligence required | Use as reference and lineage check, not the primary fork target. |
| Algebra Integral | BUSL-1.1 in current Integral sources inspected during research | Matches Barkswap-style pools but introduces plugin/dynamic-fee complexity | Build adapter support; do not use as owned clone baseline without license approval. |
| Velodrome Slipstream | GPL-2.0-or-later in CL pool sources inspected during research | V3-style but tied to ve/gauge ecosystem assumptions | Reference only unless a ve/gauge DEX is intentionally selected. |
| Kyber Elastic | Custom CLAMM lineage with major exploit history | More custom math and higher audit burden | Reject as clone baseline. |

## Aggregator Baseline Evaluation

The aggregator should be advanced in the 1inch sense: source registry, pathfinding, split routes, gas-aware scoring, route transparency, and executable transaction construction. It should not be a literal 1inch clone because the relevant 1inch production system is not an open-source codebase we can safely vendor as project infrastructure.

| Candidate/reference | What to reuse | What to avoid |
| --- | --- | --- |
| 1inch Pathfinder model | Route graph, split-routing concept, liquidity-source transparency | Treating proprietary/commercial infrastructure as a clone baseline. |
| OKX DEX Router EVM V1 | MIT-licensed adapter/router design ideas after review | Copying broad arbitrary-call surfaces into DogeOS V1. |
| ParaSwap DexLib | Adapter admission rigor, state/pricing separation, test expectations | Copying GPL-3 code into a project that has not accepted that obligation. |
| Odos Router V2 | Multi-hop/split-route concepts and min-return emphasis | Multi-input/output and arbitrary execution patterns in V1. |
| Uniswap/Pancake smart routers | Family-specific V3 route calculation patterns | Overfitting to only one protocol family. |

## Liquidity Source Plan

| Source ID | Protocol type | V1 status | Execution gate |
| --- | --- | --- | --- |
| `owned-pancake-v3` | Pancake/Uniswap V3-like CLAMM | Planned owned source after GPL approval | Deploy, verify, seed WDOGE/USDC and WDOGE/USDT pools, then enable. |
| `muchfi-v3` | V3-like CLAMM | Quote/read target | Enable execution only after router/quoter/periphery ABI and address confirmation. |
| `muchfi-v2` | Uniswap V2-like pairs | Quote/read target | Enable execution only after router ABI and address confirmation. |
| `barkswap-algebra` | Algebra-style CLAMM | Quote/read target | Enable execution only after canonical deployment, router/quoter, and ABI confirmation. |
| `suchswap` | Unconfirmed | Watchlist | Keep disabled until source identity and pool/router addresses are confirmed. |
| `dogebox` | Unconfirmed | Watchlist | Keep disabled until source identity and pool/router addresses are confirmed. |

## Current Source And Adapter Map

This table converts the repository discovery docs into concrete adapter work. The addresses below are route-discovery inputs, not execution approvals.

| Source ID | Adapter family | Current known contracts | Implementation posture |
| --- | --- | --- | --- |
| `owned-pancake-v3` | Pancake/Uniswap V3-like CLAMM | No DogeOS deployment yet. Upstream fork path uses `@pancakeswap/v3-core` and `@pancakeswap/v3-periphery`, both GPL-2.0-or-later. | Keep disabled until GPL is approved, code is vendored under `contracts/vendor/`, contracts are deployed, Blockscout verification is complete, and seed pools exist. |
| `muchfi-v3` | Uniswap V3-like CLAMM | Position manager `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5`; factory `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B`; pool deployer `0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348`; router candidate `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB`. | Read/quote adapter first. Execution remains disabled until MuchFi confirms router/quoter/periphery ABI and verification/provenance. |
| `muchfi-v2` | Uniswap V2-like constant product | Factory `0x7864071B532894216e3C045a74814EafEB92ae20`; WDOGE/USDC pair `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4`; WDOGE/USDT pair `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4`. | Highest-confidence read adapter because reserves are simple. Execution still waits for canonical router ABI/address. |
| `barkswap-algebra` | Algebra-style CLAMM | Older factory `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263`; newer factory `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457`; official WDOGE/USDC and WDOGE/USDT pools in both deployments. | Build read adapter against Algebra-style `poolByPair`/`globalState`. Execution waits for canonical deployment, router, quoter, and ABI confirmation. |
| `suchswap` | Unconfirmed V3-style | Position manager `0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e`; factory candidate `0x924163a558915Bf685eD21809A8B8b372A79Ed37`. | Watchlist only. Do not route until identity and router/quoter path are confirmed. |
| `dogebox` | Unconfirmed V2-like | LP contracts discovered for non-official or tiny-reserve pairs. | Watchlist only. Exclude from default source registry execution. |

## Aggregator Architecture

The system should separate route discovery, quote scoring, transaction construction, and on-chain enforcement.

```text
Token Registry
  -> Source Registry
  -> Pool Indexer
  -> Quote Sampler
  -> Route Optimizer
  -> Simulation / Validation
  -> Swap Transaction Builder
  -> Narrow On-Chain Router
```

V1 router requirements:

- Exact-input swaps only.
- Native DOGE in, native DOGE out, ERC-20 in, and ERC-20 out.
- `recipient`, `minAmountOut`, and `deadline` enforced on-chain.
- Adapter allowlist enforced on-chain.
- Clear events for route source, adapter, token in, token out, amount in, amount out, recipient, and fee.
- Emergency pause.
- Owner-controlled adapter registry during testnet; multisig plus timelock before mainnet.
- No arbitrary user-provided calldata.
- No in-contract pathfinding.
- Permit2 only after direct approval flow is implemented and reviewed.

Quote engine requirements:

- Return the winning route and nearest alternatives.
- Include current pool-state block number.
- Include execution gas estimate.
- Include DogeOS data/finality fee estimate from `L1GasPriceOracle`.
- Include calldata-size impact.
- Include expected output after pool fees.
- Include price-impact estimate.
- Include adapter/source status and verification state.
- Bind quotes to a TTL and block number.
- Reject quotes whose source state is stale or whose execution path is disabled.

Route support should stage upward:

| Stage | Route capability | Acceptance condition |
| --- | --- | --- |
| 1 | Best direct single route across certified sources | Beats manual venue selection for official-token direct pairs. |
| 2 | One-hop routing through WDOGE | Handles official-token pairs without direct pools. |
| 3 | Direct split route across certified sources | Improves net output after gas and DogeOS fees for larger swaps. |
| 4 | Full graph pathfinder | Supports deeper multi-hop and split routing when liquidity depth justifies complexity. |

## Licensing And Compliance Gates

Before any PancakeSwap V3 fork code enters the repository:

1. Legal/project owner approves GPL-2.0-or-later as compatible with the DogeOS product and distribution plan.
2. Repository keeps upstream copyright and license notices.
3. Forked code is isolated under a clear path such as `contracts/vendor/pancake-v3-*`.
4. New DogeOS-native contracts are separately licensed according to project policy.
5. Public docs disclose that the owned V3 DEX core is a GPL fork if that path is selected.
6. Any dependency with BUSL, GPL-3, unclear provenance, or proprietary terms is treated as reference-only unless separately approved.

## Risk Register

| Risk | Severity | Why it matters | Mitigation / gate |
| --- | --- | --- | --- |
| GPL acceptance is a product-policy change | High | Existing owned-DEX strategy preferred permissively licensed code or owned code; Pancake V3 creates GPL obligations for copied and derivative code. | Require explicit `GPL_APPROVED` decision before vendoring. Keep GPL code isolated under `contracts/vendor/` and preserve notices/SPDX. |
| Rewriting Pancake CLAMM math for Solidity `0.8.30` | High | Porting from upstream Solidity `=0.7.6` changes audited arithmetic and pool behavior. | Keep forked core/periphery compiler lineage for V1; put DogeOS-native router/adapters in separate `^0.8.30` code. |
| External DEX execution against unverified periphery | High | Barkswap and MuchFi pools are visible, but router/quoter ABIs are not fully confirmed in repo evidence. | Quote/read first; require signed/canonical ABI or Blockscout verification before enabling execution. |
| Arbitrary calldata route execution | High | A generic aggregator router can become a token-draining primitive if users or backend can inject arbitrary calls. | Use typed adapters, on-chain adapter allowlist, min-out, deadline, recipient enforcement, and no arbitrary user-provided calls. |
| DogeOS fee mispricing | Medium | Split or long-calldata routes can look better by gross output but lose after Data and Finality fees. | Score routes by net output after execution gas plus `L1GasPriceOracle` data/finality fee estimate. |
| Token decimal assumptions | Medium | DogeOS testnet USDC/USDT report 18 decimals, unlike Ethereum mainnet. | Read/capture decimals on-chain and test registry values. |
| Reorg-sensitive analytics and stale quotes | Medium | DogeOS docs document up to 17-block reorg depth. | Bind quotes to block/TTL; keep indexer rollback/finality buffer for canonical analytics. |
| Owned DEX conflict of interest | Medium | Aggregator ownership of a DEX can look like forced routing. | Rank by net executable output, expose source composition, support source exclusions, and keep owned source disabled unless it objectively wins. |
| Audit lineage overconfidence | Medium | Pancake/Uniswap audits help only if fork changes are minimal and deployment/config are reviewed. | Treat upstream audits as lineage evidence, not a DogeOS audit. Require internal review before testnet liquidity and external audit before mainnet TVL push. |

## Security And Audit Gates

V1 must not ship external execution until each venue passes an adapter admission checklist:

- Source and ABI are verified, or the venue team provides signed/canonical ABI artifacts.
- Factory, pool, router, quoter, and position-manager addresses are mapped.
- Adapter tests prove pool discovery, quote calculation, and disabled execution behavior.
- Fork tests compare quoted output with simulated execution for representative official-token swaps.
- Router tests cover min-out, deadline, recipient, pause, adapter allowlist, native DOGE wrap/unwrap, and no arbitrary calldata path.
- Quote service tests include stale quote rejection, disabled source rejection, 18-decimal token handling, DogeOS fee scoring, and route alternatives.
- Indexer tests include 17-block reorg rollback behavior.
- Blockscout verification is complete for owned contracts before any public liquidity push.

Solidity implementation must also follow the installed `solidity-agent-kit` practices:

- Prefer custom errors over revert strings.
- Add NatSpec for all public and external functions.
- Use `Ownable2Step` for single-owner controls and move mainnet control to multisig plus timelock.
- Use `Pausable` for user-facing emergency stop behavior.
- Use `ReentrancyGuard` and checks-effects-interactions around all external value or token flows.
- Use `SafeERC20` for all ERC-20 transfers and allowance changes.
- Reject zero addresses and zero amounts where funds or configuration are involved.
- Avoid raw `approve`, raw `transfer`, untrusted `delegatecall`, `tx.origin` authentication, and arbitrary external calls.
- Add Foundry unit, revert-path, event, fuzz, fork, gas-report, and coverage gates before deployment.
- Run the six-layer preflight checklist before any on-chain operation: permissions, dependencies, parameters, security, local testing, execution capture.

The generic Solidity Agent Kit pragma preference is overridden by DogeOS docs for DogeOS-native contracts: use Solidity `^0.8.30` unless an upstream audited fork must keep its original compiler. PancakeSwap V3 forked core should keep its upstream compiler lineage if GPL is approved.

## Initial Pool And Fee-Tier Policy

Owned V3 DEX V1 should launch with:

| Pair | Initial fee tiers | Reason |
| --- | --- | --- |
| WDOGE/USDC | `500`, `2500` | Matches visible DogeOS MuchFi V3 behavior and supports stable/liquid routing experiments. |
| WDOGE/USDT | `500`, `2500` | Gives the aggregator two stablecoin paths and keeps fee-tier behavior consistent. |

Later candidates are WDOGE/USD1, WDOGE/WETH, and WDOGE/LBTC after official-token liquidity demand is measured.

Protocol fees should be disabled or near-zero on testnet. Any mainnet fee must be capped on-chain, visible in quotes, and routed to a documented treasury/multisig recipient.

## Acceptance Criteria For This Strategy

This strategy is ready to become implementation work when:

- A project owner approves either the GPL PancakeSwap V3 fork path or the non-GPL fallback path.
- The source registry schema includes owned V3, MuchFi V3, MuchFi V2, Barkswap Algebra, and watchlist sources.
- The router design remains narrow and exact-input only.
- DogeOS native DOGE, WDOGE, 18-decimal official tokens, L1 data/finality fees, and 17-block reorg behavior are explicit requirements.
- External venue execution remains gated until contracts and ABIs are confirmed.
- The implementation plan lists concrete files, phases, tests, and acceptance criteria.
