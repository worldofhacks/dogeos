# DogeOS DEX V3 Fork And Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DogeOS owned V3 DEX fork path and advanced 1inch-style same-chain aggregator without introducing unsafe execution surfaces or unresolved license risk.

**Architecture:** Use a narrow on-chain router with typed allowlisted adapters, while a TypeScript quote engine performs source discovery, DogeOS fee-aware scoring, simulation, and staged pathfinding. Use PancakeSwap V3 as the owned CLAMM baseline only after GPL approval; otherwise ship aggregator-first and keep owned CLAMM disabled.

**Tech Stack:** Solidity/Foundry for contracts, TypeScript with viem or ethers for the quote engine, DogeOS RPC/Blockscout for validation, and repository docs for source-of-truth deployment metadata.

---

## Reference Spec

Implement against [2026-05-21-dogeos-dexv3-aggregator-design.md](../specs/2026-05-21-dogeos-dexv3-aggregator-design.md).

## Solidity Quality Gates

Use the installed `solidity-agent-kit` skills during implementation:

| Skill | Required use in this plan |
| --- | --- |
| `solidity-coding` | Before writing or modifying `.sol` files; enforce NatSpec, custom errors, named imports, events for state changes, and clear initialization choices. |
| `solidity-security` | Before router/adapter implementation; enforce `Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, CEI, zero-address checks, zero-amount checks, and no raw token calls. |
| `solidity-testing` | Before writing `.t.sol`; require isolated tests, revert-path checks, event assertions, fuzz tests, fork tests, and `forge coverage`. |
| `solidity-audit` | Before public testnet liquidity; review reentrancy, access control, arbitrary calls, ERC-20 compatibility, MEV, storage, and trust boundaries. |
| `defi-security` | Before any DEX deployment; require MEV/slippage/deadline protection, emergency pause tests, multisig/timelock readiness, and 10,000-run fuzz tests on fund flows. |
| `solidity-checklist` | Before any `cast send` or `forge script --broadcast`; complete permissions, dependencies, parameters, security, testing, and execution capture. |
| `solidity-deploy` | Before deployment scripts and Blockscout verification runbooks. |

DogeOS docs override the generic Solidity Agent Kit pragma suggestion for DogeOS-native contracts: new router/adapters use `pragma solidity ^0.8.30;`. Forked PancakeSwap V3 code keeps its upstream compiler and license headers if the GPL path is approved.

Pin OpenZeppelin Contracts to `5.6.1` for DogeOS-native contracts unless implementation-time review selects a newer version. With OZ v5, import `Pausable` and `ReentrancyGuard` from `@openzeppelin/contracts/utils/`, call the inherited `Ownable` constructor, and use `SafeERC20.forceApprove` instead of the removed `safeApprove` helper.

## File Structure

Create these areas when implementation begins:

| Path | Responsibility |
| --- | --- |
| `contracts/foundry.toml` | Foundry profile for DogeOS router/adapters and fork tests. |
| `contracts/remappings.txt` | OpenZeppelin Contracts v5.6.1 and vendor import remappings. |
| `contracts/src/router/DogeOSSwapRouter.sol` | Narrow exact-input router with native DOGE support, adapter allowlist, pause, min-out, deadline, and recipient enforcement. |
| `contracts/src/interfaces/IDogeOSSwapAdapter.sol` | Common typed adapter interface used by the router. |
| `contracts/src/interfaces/IWNative.sol` | WDOGE-compatible wrap/unwrap interface. |
| `contracts/src/interfaces/IL1GasPriceOracle.sol` | DogeOS data/finality fee oracle interface. |
| `contracts/src/adapters/UniswapV2LikeAdapter.sol` | Adapter for MuchFi V2-style pairs after router confirmation. |
| `contracts/src/adapters/UniswapV3LikeAdapter.sol` | Adapter for MuchFi V3 and owned Pancake-style pools. |
| `contracts/src/adapters/AlgebraLikeAdapter.sol` | Adapter for Barkswap Algebra-style pools after router/quoter confirmation. |
| `contracts/src/registry/AdapterRegistry.sol` | Owner-controlled adapter allowlist with events; timelock-ready ownership. |
| `contracts/test/router/DogeOSSwapRouter.t.sol` | Router unit tests. |
| `contracts/test/adapters/*.t.sol` | Adapter unit/fork tests. |
| `packages/dogeos-config/src/chains.ts` | DogeOS chain ID, RPC, explorer, native token, and oracle config. |
| `packages/dogeos-config/src/tokens.ts` | Official token registry with on-chain decimals verification snapshots. |
| `packages/aggregator/src/sources/registry.ts` | Source registry for owned V3, MuchFi V3, MuchFi V2, Barkswap, and watchlist venues. |
| `packages/aggregator/src/quotes/types.ts` | Route, quote, scoring, and swap transaction types. |
| `packages/aggregator/src/quotes/feeEstimator.ts` | Execution gas plus DogeOS data/finality fee estimator. |
| `packages/aggregator/src/quotes/directRoutes.ts` | Stage 1 direct-route quote sampler. |
| `packages/aggregator/src/quotes/oneHopRoutes.ts` | Stage 2 one-hop routing through WDOGE. |
| `packages/aggregator/src/quotes/splitRoutes.ts` | Stage 3 direct split-route optimizer. |
| `packages/aggregator/src/swap/buildSwapTx.ts` | Builds executable router calldata only for fresh, enabled, allowlisted routes. |
| `packages/aggregator/test/*.test.ts` | Quote engine, source registry, fee estimator, and transaction builder tests. |
| `docs/dexv3/licensing.md` | GPL decision record and dependency license inventory. |
| `docs/dexv3/adapter-admission.md` | Checklist every source must satisfy before execution is enabled. |
| `docs/dexv3/deployment-runbook.md` | DogeOS deployment, verification, pool seeding, and enablement steps. |

## Phase 0: Decision Gates

### Task 1: Record GPL Decision

**Files:**
- Create: `docs/dexv3/licensing.md`

- [ ] **Step 1: Create the licensing decision file**

Write this content:

```markdown
# DogeOS DEX V3 Licensing Decision

## Decision

The project owner must choose one path before PancakeSwap V3 code is vendored:

- `GPL_APPROVED`: PancakeSwap V3 GPL-2.0-or-later code can be forked with notices preserved.
- `GPL_REJECTED`: PancakeSwap V3 code remains reference-only and the owned CLAMM is disabled until a non-GPL path is approved.

## Approved Source Rules

1. Preserve upstream copyright notices.
2. Preserve upstream SPDX identifiers.
3. Keep forked code under `contracts/vendor/`.
4. Keep DogeOS-native router and aggregator code outside `contracts/vendor/`.
5. Document every copied dependency in this file before merging it.

## Dependency Inventory

| Dependency | Use | License | Status |
| --- | --- | --- | --- |
| PancakeSwap V3 contracts | Owned CLAMM baseline if approved | GPL-2.0-or-later | Decision required |
| Uniswap V3 contracts | Reference and lineage check | GPL/BUSL history | Reference only |
| Algebra Integral | Barkswap adapter reference | BUSL-1.1 in researched sources | Reference only |
| OKX DEX Router EVM V1 | Aggregator/router design reference | MIT | Reference only |
| Odos Router V2 | Route design reference | Repository license review required before copying | Reference only |
| ParaSwap DexLib | Adapter design reference | GPL-3 in public repo history | Reference only |
```

- [ ] **Step 2: Review gate**

Run: `rg -n "Decision required|Reference only|GPL_APPROVED|GPL_REJECTED" docs/dexv3/licensing.md`

Expected: the output shows the unresolved GPL decision and every dependency remains classified.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/dexv3/licensing.md
git commit -m "docs: record dex v3 licensing gate"
```

Expected: commit succeeds after the project owner records the GPL decision.

### Task 2: Write Adapter Admission Checklist

**Files:**
- Create: `docs/dexv3/adapter-admission.md`

- [ ] **Step 1: Create the checklist**

Write this content:

```markdown
# DogeOS DEX Adapter Admission

## Required Before Quote Support

1. Source has a stable `sourceId`.
2. Factory and pool addresses are known.
3. Token decimals are read on-chain.
4. Pool state can be read at a specific block.
5. Quote math is tested against on-chain pool state.
6. Source status is visible through `GET /sources`.

## Required Before Execution Support

1. Router address is confirmed.
2. Quoter or execution ABI is confirmed.
3. Source or ABI provenance is verified through Blockscout, official docs, or signed partner artifact.
4. Adapter has fork tests for exact-input swaps.
5. Router enforces adapter allowlist, min-out, deadline, recipient, and pause.
6. Execution source is marked `active`; unverified sources remain `readOnly` or `watchlist`.

## DogeOS-Specific Checks

1. Route scoring includes execution gas and data/finality fee.
2. Quote contains block number and TTL.
3. Indexer handles a 17-block reorg buffer.
4. Native DOGE and WDOGE behavior is tested.
5. Official token decimals are not hard-coded from Ethereum mainnet assumptions.
```

- [ ] **Step 2: Verify checklist has no execution bypass**

Run: `rg -n "arbitrary|allowlist|min-out|deadline|readOnly|watchlist" docs/dexv3/adapter-admission.md`

Expected: output shows the checklist requires allowlisting and keeps unverified sources disabled for execution.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/dexv3/adapter-admission.md
git commit -m "docs: add dex adapter admission checklist"
```

Expected: commit succeeds.

## Phase 1: Contract Foundation

### Task 3: Scaffold Router Interfaces And Tests

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `contracts/src/interfaces/IDogeOSSwapAdapter.sol`
- Create: `contracts/src/interfaces/IWNative.sol`
- Create: `contracts/src/router/DogeOSSwapRouter.sol`
- Create: `contracts/test/router/DogeOSSwapRouter.t.sol`

- [ ] **Step 1: Write the failing router tests first**

Create `contracts/test/router/DogeOSSwapRouter.t.sol` with tests for:

```solidity
function test_exactInput_revertsWhenDeadlineExpired() public;
function test_exactInput_revertsWhenAdapterNotAllowed() public;
function test_exactInput_revertsWhenOutputBelowMinAmount() public;
function test_exactInput_emitsSwapExecutedForAllowedAdapter() public;
function test_exactInput_wrapsNativeDogeForTokenSwap() public;
function test_exactInput_unwrapsWDogeForNativeDogeOutput() public;
function test_exactInput_revertsWhenPaused() public;
function testFuzz_exactInput_revertsWhenAmountInIsZero(uint256 minAmountOut) public;
```

- [ ] **Step 2: Run failing tests**

Run: `cd contracts && forge test --match-path test/router/DogeOSSwapRouter.t.sol -vvv`

Expected: tests fail because router and interfaces do not exist.

- [ ] **Step 3: Add adapter interface**

Create `contracts/src/interfaces/IDogeOSSwapAdapter.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Typed adapter interface for DogeOS router-controlled exact-input swaps.
interface IDogeOSSwapAdapter {
    /// @notice Parameters passed from the DogeOS router to an allowlisted adapter.
    /// @param tokenIn Input token; adapters receive wrapped DOGE when native DOGE is used.
    /// @param tokenOut Output token; adapters return wrapped DOGE when native DOGE is requested.
    /// @param recipient Final recipient for non-native output tokens.
    /// @param amountIn Exact input amount.
    /// @param minAmountOut Minimum acceptable adapter output.
    /// @param routeData Adapter-specific encoded route data produced by the quote service.
    struct ExactInputParams {
        address tokenIn;
        address tokenOut;
        address recipient;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes routeData;
    }

    /// @notice Execute an exact-input swap through this adapter.
    /// @param params Typed exact-input route parameters.
    /// @return amountOut Amount produced by the adapter.
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
```

- [ ] **Step 4: Add native wrapper interface**

Create `contracts/src/interfaces/IWNative.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal interface for the DogeOS wrapped native DOGE token.
interface IWNative {
    /// @notice Wrap native DOGE into WDOGE.
    function deposit() external payable;

    /// @notice Unwrap WDOGE into native DOGE.
    /// @param amount Amount of WDOGE to unwrap.
    function withdraw(uint256 amount) external;

    /// @notice Transfer WDOGE.
    /// @param to Recipient address.
    /// @param amount Amount to transfer.
    /// @return ok True when the transfer succeeds.
    function transfer(address to, uint256 amount) external returns (bool);

    /// @notice Return an account's WDOGE balance.
    /// @param account Account to inspect.
    /// @return balance Current WDOGE balance.
    function balanceOf(address account) external view returns (uint256);
}
```

- [ ] **Step 5: Implement minimal router**

Create `contracts/src/router/DogeOSSwapRouter.sol` with ERC-20 input and native DOGE input support. Native DOGE output is added in Task 4.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDogeOSSwapAdapter} from "../interfaces/IDogeOSSwapAdapter.sol";
import {IWNative} from "../interfaces/IWNative.sol";

/// @notice Narrow DogeOS exact-input swap router with typed allowlisted adapters.
contract DogeOSSwapRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error DeadlineExpired();
    error AdapterNotAllowed(address adapter);
    error OutputBelowMinimum(uint256 amountOut, uint256 minAmountOut);
    error NativeValueMismatch(uint256 expected, uint256 actual);
    error ZeroAddress();
    error ZeroAmount();

    /// @notice Emitted when adapter execution permission changes.
    event AdapterAllowed(address indexed adapter, bool allowed);

    /// @notice Emitted after an exact-input route succeeds.
    event SwapExecuted(
        address indexed adapter,
        address indexed tokenIn,
        address indexed tokenOut,
        address recipient,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Native DOGE sentinel used in quote and router calldata.
    address public constant NATIVE_DOGE = address(0);

    /// @notice Wrapped DogeOS native DOGE token.
    IWNative public immutable wDoge; // immutable because WDOGE is fixed at deploy and saves gas.

    /// @notice Adapter execution allowlist.
    mapping(address => bool) public allowedAdapter;

    /// @notice Create the DogeOS swap router.
    /// @param initialOwner Initial owner, expected to become a multisig before mainnet.
    /// @param wDoge_ Wrapped DOGE token address.
    constructor(address initialOwner, IWNative wDoge_) Ownable(initialOwner) {
        if (address(wDoge_) == address(0)) revert ZeroAddress();
        wDoge = wDoge_;
    }

    /// @notice Allow or disable an adapter.
    /// @param adapter Adapter contract address.
    /// @param allowed Whether execution through the adapter is allowed.
    function setAdapterAllowed(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        allowedAdapter[adapter] = allowed;
        emit AdapterAllowed(adapter, allowed);
    }

    /// @notice Pause user-facing swaps.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause user-facing swaps.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Execute an exact-input swap through an allowlisted adapter.
    /// @param adapter Allowlisted adapter contract.
    /// @param params Exact-input route parameters.
    /// @param deadline Latest timestamp at which the route can execute.
    /// @return amountOut Amount produced by the adapter.
    function exactInput(
        address adapter,
        IDogeOSSwapAdapter.ExactInputParams calldata params,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (!allowedAdapter[adapter]) revert AdapterNotAllowed(adapter);
        if (params.recipient == address(0)) revert ZeroAddress();
        if (params.amountIn == 0) revert ZeroAmount();

        if (params.tokenIn == NATIVE_DOGE && msg.value != params.amountIn) {
            revert NativeValueMismatch(params.amountIn, msg.value);
        }
        if (params.tokenIn != NATIVE_DOGE && msg.value != 0) {
            revert NativeValueMismatch(0, msg.value);
        }

        IDogeOSSwapAdapter.ExactInputParams memory adapterParams = params;
        if (params.tokenIn == NATIVE_DOGE) {
            wDoge.deposit{value: params.amountIn}();
            adapterParams.tokenIn = address(wDoge);
        } else {
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        }

        IERC20(adapterParams.tokenIn).forceApprove(adapter, params.amountIn);
        amountOut = IDogeOSSwapAdapter(adapter).exactInput(adapterParams);
        IERC20(adapterParams.tokenIn).forceApprove(adapter, 0);

        if (amountOut < params.minAmountOut) {
            revert OutputBelowMinimum(amountOut, params.minAmountOut);
        }

        emit SwapExecuted(
            adapter,
            params.tokenIn,
            params.tokenOut,
            params.recipient,
            params.amountIn,
            amountOut
        );
    }
}
```

- [ ] **Step 6: Run router tests**

Run: `cd contracts && forge test --match-path test/router/DogeOSSwapRouter.t.sol -vvv`

Expected: deadline, allowlist, min-out, event, pause, non-zero amount, and native DOGE input tests pass. Native DOGE output tests stay failing until Task 4 adds the WDOGE unwrap flow.

- [ ] **Step 7: Commit**

Run:

```bash
git add contracts/foundry.toml contracts/remappings.txt contracts/src contracts/test/router
git commit -m "feat: add dogeos swap router skeleton"
```

Expected: commit succeeds with the initial router foundation.

### Task 4: Add DogeOS Native DOGE Output Handling

**Files:**
- Modify: `contracts/src/router/DogeOSSwapRouter.sol`
- Modify: `contracts/test/router/DogeOSSwapRouter.t.sol`

- [ ] **Step 1: Extend tests**

Add assertions that:

```solidity
function test_exactInput_revertsWhenNativeInputMsgValueDoesNotMatchAmountIn() public;
function test_exactInput_depositsWDogeBeforeAdapterCall() public;
function test_exactInput_unwrapsWDogeAndTransfersDogeForNativeOutput() public;
function test_exactInput_usesSafeERC20ForTokenInput() public;
```

- [ ] **Step 2: Run failing native tests**

Run: `cd contracts && forge test --match-test native -vvv`

Expected: native DOGE tests fail because the router does not yet wrap or unwrap.

- [ ] **Step 3: Add native output transfer logic**

Modify router logic so native output is always received by the router as WDOGE, unwrapped, and transferred to the final recipient:

```solidity
error NativeTransferFailed();
error UnexpectedNativeDogeSender(address sender);

receive() external payable {
    if (msg.sender != address(wDoge)) revert UnexpectedNativeDogeSender(msg.sender);
}

// Inside exactInput after `IDogeOSSwapAdapter.ExactInputParams memory adapterParams = params;`
if (params.tokenOut == NATIVE_DOGE) {
    adapterParams.tokenOut = address(wDoge);
    adapterParams.recipient = address(this);
}

// After the adapter call and min-out check:
if (params.tokenOut == NATIVE_DOGE) {
    wDoge.withdraw(amountOut);
    (bool sent, ) = params.recipient.call{value: amountOut}("");
    if (!sent) revert NativeTransferFailed();
}
```

The router must deposit `msg.value` into WDOGE for native input, use `SafeERC20` for ERC-20 input transfers, approve only the selected adapter for `amountIn` with `forceApprove`, reset adapter allowance after the call, and unwrap WDOGE to native DOGE only when the requested output token is `NATIVE_DOGE`.

- [ ] **Step 4: Run native tests**

Run: `cd contracts && forge test --match-path test/router/DogeOSSwapRouter.t.sol -vvv`

Expected: native DOGE tests and existing router tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add contracts/src/router/DogeOSSwapRouter.sol contracts/test/router/DogeOSSwapRouter.t.sol
git commit -m "feat: support native doge routing"
```

Expected: commit succeeds.

## Phase 2: DogeOS Config And Source Registry

### Task 5: Add DogeOS Chain And Token Registry

**Files:**
- Create: `packages/dogeos-config/src/chains.ts`
- Create: `packages/dogeos-config/src/tokens.ts`
- Create: `packages/dogeos-config/test/tokens.test.ts`

- [ ] **Step 1: Write token registry tests**

Create tests that assert:

```ts
expect(DOGEOS_TESTNET.id).toBe(6281971);
expect(DOGEOS_TESTNET.nativeCurrency.symbol).toBe("DOGE");
expect(TOKENS.WDOGE.decimals).toBe(18);
expect(TOKENS.USDC.decimals).toBe(18);
expect(TOKENS.USDT.decimals).toBe(18);
expect(TOKENS.WDOGE.address).toBe("0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE");
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/dogeos-config/test/tokens.test.ts`

Expected: tests fail because the package does not exist yet.

- [ ] **Step 3: Add chain and token exports**

Create `chains.ts` and `tokens.ts` with DogeOS Chikyū RPC, Blockscout explorer, chain ID `6281971`, native DOGE, L1GasPriceOracle `0x5300000000000000000000000000000000000002`, and official token addresses from `docs/dogeos-chikyu-testnet.md`.

- [ ] **Step 4: Run registry tests**

Run: `pnpm test packages/dogeos-config/test/tokens.test.ts`

Expected: tests pass and prove 18-decimal official token assumptions are encoded explicitly.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/dogeos-config
git commit -m "feat: add dogeos chain and token config"
```

Expected: commit succeeds.

### Task 6: Add Source Registry

**Files:**
- Create: `packages/aggregator/src/sources/registry.ts`
- Create: `packages/aggregator/test/sourceRegistry.test.ts`

- [ ] **Step 1: Write source registry tests**

Tests must assert:

```ts
expect(getSource("owned-pancake-v3").status).toBe("disabled");
expect(getSource("muchfi-v3").protocolType).toBe("v3");
expect(getSource("muchfi-v2").protocolType).toBe("v2");
expect(getSource("barkswap-algebra").status).toBe("readOnly");
expect(getExecutableSources()).not.toContainEqual(expect.objectContaining({ sourceId: "barkswap-algebra" }));
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/aggregator/test/sourceRegistry.test.ts`

Expected: tests fail because source registry code does not exist yet.

- [ ] **Step 3: Implement source registry**

Create sources:

```ts
export type ProtocolType = "v2" | "v3" | "algebra";
export type SourceStatus = "active" | "readOnly" | "watchlist" | "disabled";

export interface LiquiditySource {
  sourceId: string;
  displayName: string;
  protocolType: ProtocolType;
  status: SourceStatus;
  factory?: `0x${string}`;
  router?: `0x${string}`;
  quoter?: `0x${string}`;
  positionManager?: `0x${string}`;
  verified: boolean;
}
```

Populate `owned-pancake-v3`, `muchfi-v3`, `muchfi-v2`, `barkswap-algebra`, `suchswap`, and `dogebox` using the status rules from the strategy spec.

- [ ] **Step 4: Run tests**

Run: `pnpm test packages/aggregator/test/sourceRegistry.test.ts`

Expected: tests pass and only sources with `status: "active"` can be returned by `getExecutableSources()`.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/sources packages/aggregator/test/sourceRegistry.test.ts
git commit -m "feat: add dogeos liquidity source registry"
```

Expected: commit succeeds.

## Phase 3: Quote Engine

### Task 7: Add Quote Types And DogeOS Fee Estimator

**Files:**
- Create: `packages/aggregator/src/quotes/types.ts`
- Create: `packages/aggregator/src/quotes/feeEstimator.ts`
- Create: `packages/aggregator/test/feeEstimator.test.ts`

- [ ] **Step 1: Write fee estimator tests**

Tests must assert:

```ts
expect(estimateNetRouteValue({ expectedOutputValue: 1000n, executionFeeValue: 10n, dataFinalityFeeValue: 3n, failurePenaltyValue: 2n })).toBe(985n);
expect(buildFeeInputs({ calldataBytes: 0 }).calldataBytes).toBe(0);
expect(() => assertFreshQuote({ quoteBlock: 100n, currentBlock: 119n, maxBlockDrift: 18n })).toThrow("STALE_QUOTE");
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/aggregator/test/feeEstimator.test.ts`

Expected: tests fail because quote types and fee estimator do not exist.

- [ ] **Step 3: Implement quote types and fee estimator**

Define `RouteCandidate`, `QuoteResult`, `FeeEstimate`, and `ScoredRoute`. Implement net scoring:

```ts
netValue =
  expectedOutputValue
  - executionFeeValue
  - dataFinalityFeeValue
  - failurePenaltyValue
  - protocolFeeValue
```

Represent every value as `bigint` and include `sourceId`, `blockNumber`, `ttlMs`, `calldataBytes`, and `verificationStatus`.

- [ ] **Step 4: Run tests**

Run: `pnpm test packages/aggregator/test/feeEstimator.test.ts`

Expected: tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/quotes packages/aggregator/test/feeEstimator.test.ts
git commit -m "feat: score routes with dogeos fees"
```

Expected: commit succeeds.

### Task 8: Implement Stage 1 Direct Routes

**Files:**
- Create: `packages/aggregator/src/quotes/directRoutes.ts`
- Create: `packages/aggregator/test/directRoutes.test.ts`

- [ ] **Step 1: Write direct-route tests**

Tests must cover:

```ts
expect(selectBestDirectRoute([routeA, routeB]).sourceId).toBe("route-with-highest-net-value");
expect(selectBestDirectRoute([disabledSourceRoute])).toBeUndefined();
expect(buildQuoteResult(routes).alternatives.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/aggregator/test/directRoutes.test.ts`

Expected: tests fail because direct-route selection does not exist.

- [ ] **Step 3: Implement direct-route selection**

Use only sources whose status permits the requested mode:

```ts
const quoteSources = sources.filter((source) =>
  mode === "quote" ? source.status === "active" || source.status === "readOnly" : source.status === "active"
);
```

Sort by `netValue` descending and return the best route plus nearest alternatives.

- [ ] **Step 4: Run tests**

Run: `pnpm test packages/aggregator/test/directRoutes.test.ts`

Expected: tests pass and disabled/watchlist sources never produce executable routes.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/quotes/directRoutes.ts packages/aggregator/test/directRoutes.test.ts
git commit -m "feat: add direct route selection"
```

Expected: commit succeeds.

### Task 9: Add Stage 2 And Stage 3 Pathfinding

**Files:**
- Create: `packages/aggregator/src/quotes/oneHopRoutes.ts`
- Create: `packages/aggregator/src/quotes/splitRoutes.ts`
- Create: `packages/aggregator/test/pathfinding.test.ts`

- [ ] **Step 1: Write pathfinding tests**

Tests must assert:

```ts
expect(findOneHopRoutes({ tokenIn: USDC, tokenOut: USDT, hubToken: WDOGE })).toContainEqual(
  expect.objectContaining({ hopCount: 2 })
);
expect(selectSplitRoute({ directRoutes, amountIn })).toEqual(expect.objectContaining({ routeType: "split" }));
expect(selectSplitRoute({ directRoutes: expensiveGasRoutes, amountIn })).toEqual(expect.objectContaining({ routeType: "single" }));
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/aggregator/test/pathfinding.test.ts`

Expected: tests fail because one-hop and split routing do not exist.

- [ ] **Step 3: Implement one-hop routing through WDOGE**

Generate only two-hop candidates where both legs use enabled quote sources and the hub token is WDOGE.

- [ ] **Step 4: Implement direct split routing**

Split only across certified direct routes. Select split routes only when net value after extra gas and data/finality fee is greater than the best single route.

- [ ] **Step 5: Run tests**

Run: `pnpm test packages/aggregator/test/pathfinding.test.ts`

Expected: tests pass and split routing is rejected when fee overhead erases output improvement.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/aggregator/src/quotes/oneHopRoutes.ts packages/aggregator/src/quotes/splitRoutes.ts packages/aggregator/test/pathfinding.test.ts
git commit -m "feat: add dogeos pathfinding stages"
```

Expected: commit succeeds.

## Phase 4: Swap Transaction Builder

### Task 10: Build Executable Router Calldata

**Files:**
- Create: `packages/aggregator/src/swap/buildSwapTx.ts`
- Create: `packages/aggregator/test/buildSwapTx.test.ts`

- [ ] **Step 1: Write swap transaction tests**

Tests must assert:

```ts
expect(() => buildSwapTx({ route: readOnlyRoute })).toThrow("SOURCE_NOT_EXECUTABLE");
expect(() => buildSwapTx({ route: staleRoute })).toThrow("STALE_QUOTE");
expect(buildSwapTx({ route: activeFreshRoute }).to).toBe(DOGEOS_SWAP_ROUTER_ADDRESS);
expect(buildSwapTx({ route: activeFreshRoute }).data).toMatch(/^0x/);
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test packages/aggregator/test/buildSwapTx.test.ts`

Expected: tests fail because transaction builder does not exist.

- [ ] **Step 3: Implement transaction builder**

Encode only `DogeOSSwapRouter.exactInput(adapter, params, deadline)` for active sources. Reject read-only, watchlist, disabled, stale, and unverified execution paths.

- [ ] **Step 4: Run tests**

Run: `pnpm test packages/aggregator/test/buildSwapTx.test.ts`

Expected: tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/swap packages/aggregator/test/buildSwapTx.test.ts
git commit -m "feat: build executable dogeos swap transactions"
```

Expected: commit succeeds.

## Phase 5: Owned Pancake V3 Fork Path

### Task 11: Vendor Pancake V3 Only After GPL Approval

**Files:**
- Create or modify: `docs/dexv3/licensing.md`
- Create: `contracts/vendor/pancake-v3-core/`
- Create: `contracts/vendor/pancake-v3-periphery/`

- [ ] **Step 1: Verify license approval**

Run: `rg -n "GPL_APPROVED" docs/dexv3/licensing.md`

Expected: output shows the project owner selected `GPL_APPROVED`.

- [ ] **Step 2: Vendor upstream code**

Import PancakeSwap V3 upstream code into `contracts/vendor/` preserving SPDX headers, license files, and upstream notices.

- [ ] **Step 3: Verify no GPL code exists outside vendor path**

Run: `rg -n "GPL-2.0-or-later|BUSL|GPL-3" contracts packages`

Expected: GPL-2.0-or-later findings are confined to `contracts/vendor/pancake-v3-*`; BUSL/GPL-3 findings are absent from copied code.

- [ ] **Step 4: Compile without DogeOS math edits**

Run: `cd contracts && forge build`

Expected: Pancake V3 fork compiles without changing CLAMM math.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/dexv3/licensing.md contracts/vendor
git commit -m "feat: vendor approved pancake v3 fork"
```

Expected: commit succeeds after license approval.

### Task 12: Deploy And Enable Owned Source

**Files:**
- Create: `docs/dexv3/deployment-runbook.md`
- Modify: `packages/aggregator/src/sources/registry.ts`
- Add: deployment scripts under `contracts/script/`

- [ ] **Step 1: Create runbook**

Document deploy order: factory, pool deployer, position manager, router/periphery, owned WDOGE/USDC pool, owned WDOGE/USDT pool, Blockscout verification, liquidity seed, source enablement.

- [ ] **Step 2: Add deployment scripts**

Create scripts that read DogeOS chain ID `6281971`, WDOGE, USDC, USDT, deployer account, and Blockscout verification config from environment variables.

- [ ] **Step 3: Keep owned source disabled before verification**

Run: `pnpm test packages/aggregator/test/sourceRegistry.test.ts`

Expected: `owned-pancake-v3` remains `disabled` until deployment addresses and verification links are committed.

- [ ] **Step 4: Enable owned source after verification**

Modify source registry with verified factory/router/quoter/position-manager addresses, WDOGE/USDC and WDOGE/USDT pools, and status `active`.

- [ ] **Step 5: Run full verification**

Run:

```bash
cd contracts && forge test
pnpm test
```

Expected: contract and TypeScript tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/dexv3/deployment-runbook.md contracts/script packages/aggregator/src/sources/registry.ts
git commit -m "feat: enable verified owned v3 source"
```

Expected: commit succeeds after verified deployment data is present.

## Phase 6: Final Validation

### Task 13: Completion Audit

**Files:**
- Modify: `docs/dexv3/deployment-runbook.md`

- [ ] **Step 1: Build prompt-to-artifact checklist**

Add a checklist mapping every requirement from the strategy spec to evidence:

```markdown
| Requirement | Evidence |
| --- | --- |
| Pancake V3 GPL gate resolved | `docs/dexv3/licensing.md` |
| Narrow router exact-input only | `contracts/src/router/DogeOSSwapRouter.sol` and router tests |
| Adapter allowlist | router tests and source registry tests |
| DogeOS chain config | `packages/dogeos-config/src/chains.ts` |
| 18-decimal official tokens | token registry tests |
| Data/finality fee scoring | fee estimator tests |
| 17-block stale/reorg guard | quote freshness tests and indexer tests |
| External venues gated | source registry tests and adapter admission checklist |
| Owned V3 source verified before active | source registry tests and Blockscout links |
```

- [ ] **Step 2: Run verification commands**

Run:

```bash
rg -n "TO[D]O|TB[D]|fill[[:space:]]in|implement[[:space:]]later|appropriate[[:space:]]error[[:space:]]handling" docs contracts packages
cd contracts && forge test
pnpm test
```

Expected: placeholder scan returns no matches in implementation artifacts, Foundry tests pass, and TypeScript tests pass.

- [ ] **Step 3: Commit audit**

Run:

```bash
git add docs/dexv3/deployment-runbook.md
git commit -m "docs: add dexv3 completion audit"
```

Expected: commit succeeds.

## Acceptance Criteria

Implementation is complete only when:

- GPL path is explicitly approved or the owned Pancake V3 source remains disabled.
- Router has no arbitrary calldata path and only supports typed exact-input routes.
- Native DOGE and WDOGE flows pass tests.
- Source registry exposes owned V3, MuchFi V3, MuchFi V2, Barkswap Algebra, and watchlist sources with correct execution gating.
- Quote engine ranks by net value after execution gas, DogeOS data/finality fees, source reliability, and protocol fees.
- Stage 1 direct routes, Stage 2 WDOGE one-hop routes, and Stage 3 direct split routes have tests.
- External execution is enabled only for sources with confirmed routers/quoters/ABIs.
- Owned contracts are verified on Blockscout before the owned source is active.
- Completion audit maps every strategy requirement to real evidence.
