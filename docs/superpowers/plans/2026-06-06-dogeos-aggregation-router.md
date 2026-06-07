# DogeOS Aggregation Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mainnet-grade, immutable command/executor aggregation router in Solidity that executes atomic single/split/multi-hop swaps across MuchFi V2, MuchFi V3, and Barkswap Algebra on DogeOS, pulling funds via Permit2 AllowanceTransfer, with an off-by-default capped fee, Safe+timelock governance, guardian pause, a guarded-launch notional cap, and a full Trail-of-Bits security program.

**Architecture:** A single `DogeOSAggregationRouter` exposes `execute(bytes commands, bytes[] inputs, uint256 deadline)`. Each command byte dispatches to a fixed, whitelisted handler (Permit2 pull, per-venue swap against an *immutable* venue router, wrap/unwrap, fee, min-out, sweep) operating on a shared running balance. Funds are measured by balance delta, never by venue return values; the router holds ~zero balance between transactions. Cross-chain stays off-chain (NEAR Intents, Sub-project D) — no contract changes.

**Tech Stack:** Foundry (forge/cast/anvil), Solidity 0.8.26, OpenZeppelin (SafeERC20, Ownable2Step, Pausable, ReentrancyGuard), Uniswap Permit2 (etched in tests), Slither + Echidna + Medusa, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-06-dogeos-aggregation-router-spec.md`
**Program:** `docs/superpowers/specs/2026-06-06-dogeos-premium-aggregator-v2-program.md`

---

## Frozen constants (used throughout — keep identical across every task)

| Name | Value |
| --- | --- |
| Chain id | `6281971` (DogeOS Chikyu Testnet) |
| RPC | `https://rpc.testnet.dogeos.com` |
| Blockscout | `https://blockscout.testnet.dogeos.com` |
| Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| MuchFi V2 router | `0xC653e745FC613a03D156DACB924AE8e9148B18dc` |
| MuchFi V3 router (SwapRouter02, no deadline) | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` |
| Barkswap Algebra router (Integral, has `deployer`) | `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` |
| L1 fee oracle | `0x5300000000000000000000000000000000000002` |
| MAX_FEE_BPS | `100` (1%) |
| `CONTRACT_BALANCE` sentinel | `type(uint256).max` (means "use full router balance of this token") |

### Command bytes (the fixed whitelist — never add a `CALL`/`DELEGATECALL` command)

| Byte | Command | Input (abi.encode) |
| --- | --- | --- |
| `0x00` | `PERMIT2_PERMIT` | `(IAllowanceTransfer.PermitSingle permitSingle, bytes signature)` — owner is always `msg.sender` |
| `0x01` | `PERMIT2_TRANSFER_FROM` | `(address token, uint160 amount)` — pulls from `msg.sender` only |
| `0x02` | `V2_SWAP` | `(uint256 amountIn, uint256 amountOutMin, address[] path)` |
| `0x03` | `V3_SWAP` | `(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMin)` |
| `0x04` | `ALGEBRA_SWAP` | `(address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint256 amountOutMin)` |
| `0x05` | `WRAP_NATIVE` | `(uint256 amount)` |
| `0x06` | `UNWRAP_NATIVE` | `(uint256 amount)` |
| `0x07` | `PAY_FEE` | `(address token)` |
| `0x08` | `SWEEP` | `(address token, address recipient)` |
| `0x09` | `MIN_OUT_CHECK` | `(address token, uint256 minOut)` |

Swap commands carry **no router address** — the venue is the contract's immutable, so arbitrary targets are impossible by construction. `token == address(0)` in `SWEEP` means native DOGE.

---

## v2 Hardening Overrides (AUTHORITATIVE — read before the tasks below)

A pre-execution review (commit history; see the spec's "Hardening Revisions" section) changed
the design. **Where this section conflicts with a base task below, this section wins.** Tasks
not mentioned here (interfaces 1.1, venue handler bodies 2.1–2.3, Slither/Echidna/Medusa 4.x,
fork 5.1, audit-prep 6.1) stay valid — but every test's `router.execute(...)` call now uses the
**4-arg signature** `execute(commands, inputs, settlement, deadline)` (see rule O-5).

### O-1. Revised command set (movement-only)

`PAY_FEE`, `MIN_OUT_CHECK`, and `SWEEP` are **removed** — enforced settlement (O-3) does fee +
min-out + payout + refund. `Commands.sol` becomes:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
library Commands {
    bytes1 internal constant PERMIT2_PERMIT        = 0x00;
    bytes1 internal constant PERMIT2_TRANSFER_FROM = 0x01;
    bytes1 internal constant V2_SWAP               = 0x02;
    bytes1 internal constant V3_SWAP               = 0x03;
    bytes1 internal constant ALGEBRA_SWAP          = 0x04;
    bytes1 internal constant WRAP_NATIVE           = 0x05;
    bytes1 internal constant UNWRAP_NATIVE         = 0x06;
}
```

`Constants.sol` adds the native sentinel:

```solidity
address internal constant NATIVE = 0xEEeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
```

### O-2. New Phase 0 (replaces Tasks 0.0–0.5 ordering)

- **Task 0.0 (NEW) — Install Foundry:** `curl -L https://foundry.paradigm.xyz | bash && foundryup && forge --version && cast --version`. Everything else in Phase 0 depends on it.
- **Task 0.1 — EVM target (REVISED per DogeOS docs + on-chain probe):** DogeOS is a **Prague-compatible Dogecoin zkEVM**. Per the official docs use `evm_version = "prague"` and Solidity ≥ `0.8.30`. Confirm with a key-free opcode probe: `cast call --rpc-url $RPC --create 0x5f5ff3` (PUSH0), `cast call --rpc-url $RPC --create 0x600160005c60005d5000` (TSTORE/TLOAD), `cast call --rpc-url $RPC --create 0x6000600060005e00` (MCOPY) — all return `0x` (supported, verified 2026-06-06). Use OZ `ReentrancyGuardTransient`. Record in `audit/CHAIN_FACTS.md` the probe result + precompile constraints (RIPEMD-160/blake2f/point-eval unsupported; modexp ≤32B; SELFDESTRUCT disabled; ecrecover available so Permit2/EIP-712 works). The earlier OP-Stack/Bedrock "pre-Shanghai" header heuristic was WRONG — superseded.
- **Task 0.2 — Permit2 (REVISED, now REQUIRED):** `cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url $RPC` returns `0x` → Permit2 is absent. Deploy canonical Permit2 deterministically (Arachnid proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`, canonical salt) — scheduled in the deploy phase BEFORE the router — and verify bytecode + `DOMAIN_SEPARATOR()` on Blockscout. Add `PERMIT2_DEPLOY_SALT`/initcode to Frozen Constants when chosen.
- **Task 0.4 — Scaffold (REVISED):** `forge init packages/contracts --no-git` (drop the removed `--no-commit`). Pin deps: `forge install foundry-rs/forge-std@v1.9.7 --no-git`, `forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git`, `forge install Uniswap/permit2@<pin> --no-git` (record exact tags in `REPRODUCIBILITY.md`). Mirror the pins in the CI workflow (Task 4.4).

### O-3. Revised core contract (replaces the Task 1.2 skeleton + Task 1.3/1.4 handler bodies)

This is the `src/DogeOSAggregationRouter.sol` template. (Settlement + the in-memory `Ledger` are
the heart of H1/H2/H3.)

> **CORRECTIONS (post-audit, commit `ac2f805`) — the committed contract supersedes the code below:**
> 1. `_permit2Permit` / `_permit2TransferFrom` take **NO `owner` field** and use `msg.sender`
>    (`PERMIT2.permit(msg.sender, p, sig)`, `PERMIT2.transferFrom(msg.sender, …)`). Inputs are
>    `(PermitSingle, sig)` and `(token, amount)`. This closes a critical third-party allowance-drain.
> 2. Swap/wrap/unwrap use **`_spend(L, amount, token)`** (delta-only; reverts
>    `InsufficientLedgerBalance` if amount > per-execute delta) instead of `_resolve` (absolute).
>    This closes a high-severity stranded-funds drain and makes `CONTRACT_BALANCE` = delta.
> 3. EVM target is **prague / solc 0.8.30** with **`ReentrancyGuardTransient`** (DogeOS is a
>    Prague zkEVM; transient storage confirmed on-chain). Refer to the live contract, not the
>    `paris`/`ReentrancyGuard`/`_resolve` code shown below.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "openzeppelin/access/Ownable2Step.sol";
import {Pausable} from "openzeppelin/utils/Pausable.sol";
import {ReentrancyGuard} from "openzeppelin/utils/ReentrancyGuard.sol"; // storage guard — paris, no transient storage
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Commands} from "./libraries/Commands.sol";
import {Constants} from "./libraries/Constants.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";
import {IUniswapV3SwapRouter} from "./interfaces/IUniswapV3SwapRouter.sol";
import {IAlgebraSwapRouter} from "./interfaces/IAlgebraSwapRouter.sol";

contract DogeOSAggregationRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Settlement { address buyToken; uint256 minOut; address recipient; }
    /// @dev In-memory per-execute ledger (no mappings → memory-safe; linear scan, command lists are short).
    struct Ledger { address[] tokens; uint256[] entry; uint256[] pulled; uint256 count; }

    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(Constants.PERMIT2);
    address public constant NATIVE = Constants.NATIVE;
    address public immutable WDOGE;
    address public immutable MUCHFI_V2_ROUTER;
    address public immutable MUCHFI_V3_ROUTER;
    address public immutable BARKSWAP_ALGEBRA_ROUTER;

    address public guardian;
    uint256 public feeBps;
    address public feeRecipient;
    uint256 public defaultMaxInputPerTx;              // 0 = no default cap
    mapping(address => uint256) public maxInputPerTx; // 0 = use default; type(uint256).max = explicitly uncapped

    error DeadlineExpired(); error LengthMismatch(); error UnknownCommand(); error Unauthorized();
    error FeeTooHigh(); error NotionalCapExceeded(); error MinOutNotMet(); error InvalidSpender();
    error NativeTransferFailed();

    event GuardianUpdated(address indexed guardian);
    event FeeUpdated(uint256 feeBps, address indexed feeRecipient);
    event DefaultMaxInputUpdated(uint256 maxAmount);
    event MaxInputUpdated(address indexed token, uint256 maxAmount);
    event Swapped(address indexed sender, address indexed recipient);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    constructor(address owner_, address guardian_, address wdoge_, address v2_, address v3_, address alg_)
        Ownable(owner_)
    { guardian = guardian_; WDOGE = wdoge_; MUCHFI_V2_ROUTER = v2_; MUCHFI_V3_ROUTER = v3_; BARKSWAP_ALGEBRA_ROUTER = alg_; }

    receive() external payable { if (msg.sender != WDOGE) revert Unauthorized(); }

    // ---- admin (owner == TimelockController) ----
    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianUpdated(g); }
    function setFee(uint256 bps, address r) external onlyOwner {
        if (bps > Constants.MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps; feeRecipient = r; emit FeeUpdated(bps, r);
    }
    function setDefaultMaxInputPerTx(uint256 a) external onlyOwner { defaultMaxInputPerTx = a; emit DefaultMaxInputUpdated(a); }
    function setMaxInputPerTx(address t, uint256 a) external onlyOwner { maxInputPerTx[t] = a; emit MaxInputUpdated(t, a); }
    function pause() external { if (msg.sender != guardian && msg.sender != owner()) revert Unauthorized(); _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Recover funds NEVER brought in via execute (airdrops/stranded). Not reachable from execute().
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        _pay(token, to, amount); emit Rescued(token, to, amount);
    }

    // ---- core ----
    function execute(bytes calldata commands, bytes[] calldata inputs, Settlement calldata s, uint256 deadline)
        external payable whenNotPaused nonReentrant
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 n = commands.length;
        if (inputs.length != n) revert LengthMismatch();

        Ledger memory L;
        L.tokens = new address[](n + 2); L.entry = new uint256[](n + 2); L.pulled = new uint256[](n + 2);
        // seed native entry EXCLUDING this call's incoming value
        L.tokens[0] = NATIVE; L.entry[0] = address(this).balance - msg.value; L.count = 1;
        if (s.recipient != address(0)) _touch(L, s.buyToken); // snapshot buyToken entry

        for (uint256 i; i < n; ) { _dispatch(commands[i], inputs[i], deadline, L); unchecked { ++i; } }

        _settle(s, L);
        emit Swapped(msg.sender, s.recipient);
    }

    // ---- ledger (in-memory; paris-safe) ----
    function _bal(address t) internal view returns (uint256) {
        return t == NATIVE ? address(this).balance : IERC20(t).balanceOf(address(this));
    }
    function _idx(Ledger memory L, address t) internal view returns (uint256) {
        for (uint256 i; i < L.count; ++i) if (L.tokens[i] == t) return i;
        uint256 j = L.count; L.tokens[j] = t; L.entry[j] = _bal(t); L.count = j + 1; return j;
    }
    function _touch(Ledger memory L, address t) internal view { _idx(L, t); }
    function _delta(Ledger memory L, address t) internal view returns (uint256) {
        uint256 j = _idx(L, t); uint256 cur = _bal(t); return cur > L.entry[j] ? cur - L.entry[j] : 0;
    }
    function _capOf(address t) internal view returns (uint256) {
        uint256 c = maxInputPerTx[t];
        if (c == type(uint256).max) return type(uint256).max;
        if (c == 0) return defaultMaxInputPerTx == 0 ? type(uint256).max : defaultMaxInputPerTx;
        return c;
    }
    function _accrueInput(Ledger memory L, address t, uint256 amount) internal view {
        uint256 j = _idx(L, t); uint256 total = L.pulled[j] + amount; L.pulled[j] = total;
        uint256 cap = _capOf(t);
        if (cap != type(uint256).max && total > cap) revert NotionalCapExceeded();
    }

    function _dispatch(bytes1 c, bytes calldata input, uint256 deadline, Ledger memory L) internal {
        if (c == Commands.PERMIT2_PERMIT) _permit2Permit(input);
        else if (c == Commands.PERMIT2_TRANSFER_FROM) _permit2TransferFrom(input, L);
        else if (c == Commands.V2_SWAP) _v2Swap(input, deadline, L);
        else if (c == Commands.V3_SWAP) _v3Swap(input, L);
        else if (c == Commands.ALGEBRA_SWAP) _algebraSwap(input, deadline, L);
        else if (c == Commands.WRAP_NATIVE) _wrapNative(input, L);
        else if (c == Commands.UNWRAP_NATIVE) _unwrapNative(input);
        else revert UnknownCommand();
    }

    function _permit2Permit(bytes calldata input) internal {
        (address o, IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            abi.decode(input, (address, IAllowanceTransfer.PermitSingle, bytes));
        if (p.spender != address(this)) revert InvalidSpender();
        PERMIT2.permit(o, p, sig);
    }
    function _permit2TransferFrom(bytes calldata input, Ledger memory L) internal {
        (address o, address token, uint160 amount) = abi.decode(input, (address, address, uint160));
        _accrueInput(L, token, amount);
        PERMIT2.transferFrom(o, address(this), amount, token);
    }
    function _resolve(uint256 a, address t) internal view returns (uint256) {
        return a == Constants.CONTRACT_BALANCE ? _bal(t) : a;
    }
    function _approveVenue(address t, address venue, uint256 a) internal {
        if (IERC20(t).allowance(address(this), venue) < a) IERC20(t).forceApprove(venue, type(uint256).max);
    }
    function _v2Swap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (uint256 amountIn, uint256 minOut, address[] memory path) = abi.decode(input, (uint256, uint256, address[]));
        amountIn = _resolve(amountIn, path[0]); _touch(L, path[path.length - 1]);
        _approveVenue(path[0], MUCHFI_V2_ROUTER, amountIn);
        IUniswapV2Router(MUCHFI_V2_ROUTER).swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline);
    }
    function _v3Swap(bytes calldata input, Ledger memory L) internal {
        (address tin, address tout, uint24 fee, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, uint24, uint256, uint256));
        amountIn = _resolve(amountIn, tin); _touch(L, tout);
        _approveVenue(tin, MUCHFI_V3_ROUTER, amountIn);
        IUniswapV3SwapRouter(MUCHFI_V3_ROUTER).exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams({
            tokenIn: tin, tokenOut: tout, fee: fee, recipient: address(this),
            amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }));
    }
    function _algebraSwap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (address tin, address tout, address dep, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, address, uint256, uint256));
        amountIn = _resolve(amountIn, tin); _touch(L, tout);
        _approveVenue(tin, BARKSWAP_ALGEBRA_ROUTER, amountIn);
        IAlgebraSwapRouter(BARKSWAP_ALGEBRA_ROUTER).exactInputSingle(IAlgebraSwapRouter.ExactInputSingleParams({
            tokenIn: tin, tokenOut: tout, deployer: dep, recipient: address(this),
            deadline: deadline, amountIn: amountIn, amountOutMinimum: minOut, limitSqrtPrice: 0 }));
    }
    function _wrapNative(bytes calldata input, Ledger memory L) internal {
        uint256 a = _resolve(abi.decode(input, (uint256)), NATIVE);
        _accrueInput(L, NATIVE, a); _touch(L, WDOGE);
        IWETH9(WDOGE).deposit{value: a}();
    }
    function _unwrapNative(bytes calldata input) internal {
        uint256 a = _resolve(abi.decode(input, (uint256)), WDOGE);
        IWETH9(WDOGE).withdraw(a);
    }

    // ---- enforced settlement (I2/I4/I5 by construction) ----
    function _settle(Settlement calldata s, Ledger memory L) internal {
        if (s.recipient == address(0)) return; // no-op (unit tests only)
        uint256 out = _delta(L, s.buyToken);
        uint256 fee;
        if (feeBps != 0 && out != 0) { fee = (out * feeBps) / Constants.BPS_DENOMINATOR; out -= fee; }
        if (out < s.minOut) revert MinOutNotMet();
        if (fee != 0) _pay(s.buyToken, feeRecipient, fee);
        _pay(s.buyToken, s.recipient, out);
        for (uint256 i; i < L.count; ++i) {           // refund leftover input deltas to caller
            address t = L.tokens[i];
            if (t == s.buyToken) continue;
            uint256 d = _delta(L, t);
            if (d != 0) _pay(t, msg.sender, d);
        }
    }
    function _pay(address t, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (t == NATIVE) { (bool ok,) = to.call{value: amount}(""); if (!ok) revert NativeTransferFailed(); }
        else IERC20(t).safeTransfer(to, amount);
    }
}
```

### O-4. New / expanded test tasks

- **Task 3.3 (REPLACE) — invariants I1–I8:** handler builds Permit2 swaps and asserts, as fuzzed invariants: `I1` router delta-residual zero, `I2` recipient ≥ declared minOut or full revert, `I3` spend ≤ permitted, `I4` exact fee (relative tolerance, not the `+1e6` slack), `I5` only {recipient, feeRecipient, venue, sender} balances rise (fuzz arbitrary recipients/tokens), `I6` paused/expired revert, `I7` only whitelisted venues called (use a call-recording venue mock), `I8` aggregate input ≤ cap.
- **Task 3.5 (NEW) — adversarial stranded-funds theft:** pre-seed the router with a second party's ERC20 **and** native; a different caller's `execute` (with a SWEEP-equivalent settlement) must NOT extract any pre-existing balance (proves H1). Assert `rescue` is owner-only and is the only recovery path.
- **Task 3.6 (NEW) — Permit2 live-allowance + cap + native edges:** (a) permit once, then a SEPARATE `execute` with only `PERMIT2_TRANSFER_FROM` (no permit) inside the window succeeds; (b) expired/insufficient allowance reverts; (c) two transfer-froms of the same token each < cap but summing > cap revert (aggregate cap); (d) `WRAP_NATIVE` over the native cap reverts; (e) an unlisted token bounded by `defaultMaxInputPerTx`; (f) intermediate-hop fee-on-transfer token with `CONTRACT_BALANCE`; (g) native settlement to a recipient that reverts on receive → documented whole-tx revert.

### O-5. Global test-signature rule

Every `router.execute(...)` call uses **`execute(commands, inputs, settlement, deadline)`**. In
the base-plan tests:
- Swaps that pay a recipient: drop the old `PAY_FEE`/`MIN_OUT_CHECK`/`SWEEP` command bytes and instead pass `Settlement({buyToken: <out>, minOut: <floor>, recipient: <to>})`.
- Unit tests that intentionally leave funds in the router (e.g. the bare V2/V3/Algebra handler tests 2.1–2.3) pass a **no-op** settlement `Settlement({buyToken: address(0), minOut: 0, recipient: address(0)})` and assert on the router's own balance as before.
- The `PermitSignature` helper, `MockERC20`, `MockWDOGE`, and venue mocks are unchanged; the V3/Algebra `MockV3Router`/`MockAlgebraRouter` get an optional caller-recording field for I7.

### O-6. Timelock + deploy (augments Tasks 5.2/5.3)

- **Task 5.0 (NEW) — TimelockController:** deploy an OZ `TimelockController(minDelay = TIMELOCK_DELAY, proposers = [SAFE], executors = [SAFE])`; the router's `owner_` is this timelock. Tests: fee/cap/unpause routed through the timelock respect `minDelay`; guardian can pause but cannot `setFee`/`setMaxInputPerTx`/`unpause`/`transferOwnership`; Ownable2Step handover requires `acceptOwnership`. Add `TIMELOCK_DELAY` (e.g. `48 hours`) to Frozen Constants.
- **Task 5.2 (REVISE) DeployRouter.s.sol:** in ONE broadcast — deploy canonical Permit2 if absent → deploy TimelockController → deploy router (owner = timelock) → deploy `RouterRegistry` → `setCurrentRouter` → **set `defaultMaxInputPerTx` + per-token guarded caps** (so the router is never live-and-uncapped) → assert `owner()==timelock`, `guardian` set, `feeBps==0`, caps set. Record all in `DEPLOYMENT.md`.

### O-7. Early size gate

Add `forge build --sizes` (assert ≤ 24,576 bytes) as a step at the end of Task 1.2 (not only Task 6.1), since the ledger + settlement add bytecode.

---

## File structure

All new on-chain code lives in a self-contained Foundry workspace so it never entangles the Node packages.

```
packages/contracts/
  foundry.toml                         # solc/evm/optimizer/invariant/rpc config
  remappings.txt                       # permit2/, openzeppelin/, forge-std/
  .gitignore                           # out/, cache/, broadcast/, corpus/
  slither.config.json                  # static-analysis triage
  echidna.yaml                         # Echidna assertion-mode config
  medusa.json                          # Medusa fuzzing config
  src/
    DogeOSAggregationRouter.sol        # the router
    RouterRegistry.sol                 # immutable current-version pointer
    libraries/Commands.sol             # command byte constants
    libraries/Constants.sol            # CONTRACT_BALANCE, MAX_FEE_BPS
    interfaces/IWETH9.sol              # WDOGE deposit/withdraw
    interfaces/IUniswapV2Router.sol
    interfaces/IUniswapV3SwapRouter.sol# SwapRouter02 (no-deadline) struct
    interfaces/IAlgebraSwapRouter.sol  # Integral (deployer) struct
  test/
    mocks/MockERC20.sol                # standard + fee-on-transfer + non-returning approve modes
    mocks/MockWDOGE.sol
    mocks/MockV2Router.sol
    mocks/MockV3Router.sol
    mocks/MockAlgebraRouter.sol
    utils/PermitSignature.sol          # EIP-712 PermitSingle signing helper
    DogeOSAggregationRouter.t.sol      # unit tests
    RouterExecute.integration.t.sol    # end-to-end single/split/multi-hop
    RouterInvariants.t.sol             # invariants I1..I8 (+ handler)
    handlers/RouterHandler.sol
    fork/RouterFork.t.sol              # live DogeOS fork + differential
  script/
    DeployRouter.s.sol                 # deploy + registry
  audit/
    THREAT_MODEL.md
    INVARIANTS.md
    KNOWN_ISSUES.md
  .github/ (repo root) workflows/contracts-security.yml
```

---

## Phase 0 — De-risking gates & scaffold

### Task 0.1: Confirm DogeOS is OP-Stack and pin the EVM version

**Files:**
- Create: `packages/contracts/audit/CHAIN_FACTS.md` (evidence record)

- [ ] **Step 1: Probe the chain with cast**

Run each and record the raw output:

```bash
RPC=https://rpc.testnet.dogeos.com
cast chain-id --rpc-url $RPC
cast code 0x5300000000000000000000000000000000000002 --rpc-url $RPC | head -c 80   # OP GasPriceOracle predeploy: expect non-"0x"
cast call 0x5300000000000000000000000000000000000002 "version()(string)" --rpc-url $RPC || true
cast block latest --rpc-url $RPC --json | python3 -c "import sys,json;b=json.load(sys.stdin);print('excessBlobGasPresent=', 'excessBlobGas' in b)"
```

- [ ] **Step 2: Decide `evm_version`**

If `excessBlobGas` is present in the block header, the chain supports Cancun → use `cancun`. Otherwise, if a recent OP-Stack `version()` returns (Ecotone+), use `shanghai`. If uncertain, use the conservative `paris` (no PUSH0/transient storage). Record the decision and the raw probe output in `packages/contracts/audit/CHAIN_FACTS.md`, including: chain id (must be `6281971`), that the GasPriceOracle predeploy has bytecode (confirms OP-Stack), and the chosen `evm_version`.

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/audit/CHAIN_FACTS.md
git commit -m "chore(contracts): record DogeOS chain facts + evm_version decision"
```

> Default for the rest of this plan: `evm_version = "paris"` (safe everywhere). If Step 2 confirmed Cancun, change `evm_version` to `cancun` in `foundry.toml` (Task 0.5) and you may later switch `ReentrancyGuard` → `ReentrancyGuardTransient` (noted in Task 1.2).

### Task 0.2: Verify or deploy canonical Permit2 on DogeOS

**Files:**
- Modify: `packages/contracts/audit/CHAIN_FACTS.md`

- [ ] **Step 1: Check if Permit2 already exists**

```bash
RPC=https://rpc.testnet.dogeos.com
cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url $RPC | head -c 20
```

Expected: a long `0x60...` runtime if present; `0x` if absent.

- [ ] **Step 2: Record outcome and the deploy fallback**

Append to `CHAIN_FACTS.md`: whether Permit2 is present. If **absent**, record the deploy plan: Permit2 deploys deterministically via the Arachnid proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` with the canonical salt; deployment is executed in Task 5.2 (deploy phase) before the router, since the router hard-codes the canonical address. Do not block this phase on it.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/audit/CHAIN_FACTS.md
git commit -m "chore(contracts): record Permit2 availability on DogeOS"
```

### Task 0.3: Verify MyDoge EIP-712 typed-data signing

**Files:**
- Modify: `packages/contracts/audit/CHAIN_FACTS.md`

- [ ] **Step 1: Manual verification**

In a browser with MyDoge connected to DogeOS, call `eth_signTypedData_v4` with a sample Permit2 `PermitSingle` payload (domain `{name:"Permit2", chainId:6281971, verifyingContract:"0x0000...78BA3"}`). The repo's web layer (`apps/web/src/`) can host a throwaway button, or use the wallet's console. Confirm a signature is returned and recovers to the connected address.

- [ ] **Step 2: Record result + decision gate**

Append to `CHAIN_FACTS.md`: pass/fail. If **fail**, STOP and escalate to the program owner — the spec chose pure Permit2 and de-risking early; a failure forces revisiting the approval model (classic-approve fallback) before sub-project B builds the swap path. The contract work in this plan can still proceed (it is wallet-agnostic), but flag the risk prominently.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/audit/CHAIN_FACTS.md
git commit -m "chore(contracts): record MyDoge EIP-712 signing verification"
```

### Task 0.4: Scaffold the Foundry workspace

**Files:**
- Create: `packages/contracts/` (forge project), `packages/contracts/.gitignore`

- [ ] **Step 1: Initialize forge project (no template, keep it inside the monorepo)**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
forge init packages/contracts --no-git --no-commit
rm -rf packages/contracts/src/Counter.sol packages/contracts/test/Counter.t.sol packages/contracts/script/Counter.s.sol
```

- [ ] **Step 2: Install dependencies**

```bash
cd packages/contracts
forge install foundry-rs/forge-std --no-git
forge install Uniswap/permit2 --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
```

- [ ] **Step 3: Write `.gitignore`**

```
out/
cache/
broadcast/
corpus/
.forge-snapshots/
slither_results.json
lib/
```

> `lib/` is git-ignored and re-installed via the commands above; record exact dep commits in Task 6 for reproducibility. (If the team prefers vendored submodules, drop `lib/` from `.gitignore` and use real submodules — but the security spec only needs reproducible installs.)

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/.gitignore packages/contracts/foundry.toml
git commit -m "chore(contracts): scaffold foundry workspace"
```

### Task 0.5: Configure `foundry.toml` + remappings

**Files:**
- Create/Modify: `packages/contracts/foundry.toml`, `packages/contracts/remappings.txt`

- [ ] **Step 1: Write `remappings.txt`**

```
forge-std/=lib/forge-std/src/
permit2/=lib/permit2/
openzeppelin/=lib/openzeppelin-contracts/contracts/
```

- [ ] **Step 2: Write `foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.26"
evm_version = "paris"          # set to the value recorded in Task 0.1
optimizer = true
optimizer_runs = 1_000_000
# NOTE: do NOT enable via_ir. Permit2 is etched as prebuilt bytecode in tests
# (DeployPermit2), so we never compile Permit2 source and avoid its via_ir/0.8.17 pins.
bytecode_hash = "none"
fs_permissions = [{ access = "read", path = "./"}]

[invariant]
runs = 256
depth = 100
fail_on_revert = false

[fuzz]
runs = 256

[rpc_endpoints]
dogeos = "https://rpc.testnet.dogeos.com"

[etherscan]
dogeos = { key = "blockscout", url = "https://blockscout.testnet.dogeos.com/api", chain = 6281971 }
```

- [ ] **Step 3: Verify the toolchain builds**

Run: `cd packages/contracts && forge build`
Expected: PASS (compiles forge-std + OZ; no src yet besides defaults). If `DeployPermit2` import errors later, that is handled in Task 1.3.

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/foundry.toml packages/contracts/remappings.txt
git commit -m "chore(contracts): foundry config + remappings"
```

---

## Phase 1 — Core contract: dispatch, access control, Permit2, payments

### Task 1.1: Libraries and interfaces

**Files:**
- Create: `packages/contracts/src/libraries/Commands.sol`
- Create: `packages/contracts/src/libraries/Constants.sol`
- Create: `packages/contracts/src/interfaces/IWETH9.sol`
- Create: `packages/contracts/src/interfaces/IUniswapV2Router.sol`
- Create: `packages/contracts/src/interfaces/IUniswapV3SwapRouter.sol`
- Create: `packages/contracts/src/interfaces/IAlgebraSwapRouter.sol`

- [ ] **Step 1: Write `Commands.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fixed command byte whitelist for DogeOSAggregationRouter.execute.
/// @dev No CALL/DELEGATECALL/arbitrary-target command exists, by design.
library Commands {
    bytes1 internal constant PERMIT2_PERMIT        = 0x00;
    bytes1 internal constant PERMIT2_TRANSFER_FROM = 0x01;
    bytes1 internal constant V2_SWAP               = 0x02;
    bytes1 internal constant V3_SWAP               = 0x03;
    bytes1 internal constant ALGEBRA_SWAP          = 0x04;
    bytes1 internal constant WRAP_NATIVE           = 0x05;
    bytes1 internal constant UNWRAP_NATIVE         = 0x06;
    bytes1 internal constant PAY_FEE               = 0x07;
    bytes1 internal constant SWEEP                 = 0x08;
    bytes1 internal constant MIN_OUT_CHECK         = 0x09;
}
```

- [ ] **Step 2: Write `Constants.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library Constants {
    /// @dev Sentinel meaning "use the router's full current balance of the token".
    uint256 internal constant CONTRACT_BALANCE = type(uint256).max;
    /// @dev Hard cap on the configurable protocol fee (1%).
    uint256 internal constant MAX_FEE_BPS = 100;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
}
```

- [ ] **Step 3: Write `IWETH9.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
```

- [ ] **Step 4: Write `IUniswapV2Router.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
```

- [ ] **Step 5: Write `IUniswapV3SwapRouter.sol`** (SwapRouter02 — NO deadline; matches selector `0x04e45aaf`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
```

- [ ] **Step 6: Write `IAlgebraSwapRouter.sol`** (Integral — HAS deployer + deadline; matches selector `0x1679c792`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IAlgebraSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        address deployer;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 limitSqrtPrice;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
```

- [ ] **Step 7: Build and commit**

Run: `cd packages/contracts && forge build`
Expected: PASS.

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/libraries packages/contracts/src/interfaces
git commit -m "feat(contracts): command/constant libs + venue & WDOGE interfaces"
```

### Task 1.2: Router skeleton — constructor, access control, execute loop, dispatch stubs

**Files:**
- Create: `packages/contracts/src/DogeOSAggregationRouter.sol`
- Create: `packages/contracts/test/DogeOSAggregationRouter.t.sol`

- [ ] **Step 1: Write the failing test (deadline, length mismatch, pause, access control)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {Commands} from "../src/libraries/Commands.sol";

contract RouterSkeletonTest is Test {
    DogeOSAggregationRouter router;
    address owner = makeAddr("owner");        // stands in for the Timelock
    address guardian = makeAddr("guardian");
    address wdoge = makeAddr("wdoge");
    address v2 = makeAddr("v2");
    address v3 = makeAddr("v3");
    address algebra = makeAddr("algebra");

    function setUp() public {
        router = new DogeOSAggregationRouter(owner, guardian, wdoge, v2, v3, algebra);
    }

    function test_constructor_setsImmutablesAndRoles() public view {
        assertEq(router.owner(), owner);
        assertEq(router.guardian(), guardian);
        assertEq(router.WDOGE(), wdoge);
        assertEq(router.MUCHFI_V2_ROUTER(), v2);
        assertEq(router.MUCHFI_V3_ROUTER(), v3);
        assertEq(router.BARKSWAP_ALGEBRA_ROUTER(), algebra);
        assertEq(router.feeBps(), 0);
    }

    function test_execute_revertsOnExpiredDeadline() public {
        bytes memory commands = hex"08"; // SWEEP
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(0), address(this));
        vm.expectRevert(DogeOSAggregationRouter.DeadlineExpired.selector);
        router.execute(commands, inputs, block.timestamp - 1);
    }

    function test_execute_revertsOnLengthMismatch() public {
        bytes memory commands = hex"0808";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(0), address(this));
        vm.expectRevert(DogeOSAggregationRouter.LengthMismatch.selector);
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_execute_revertsOnUnknownCommand() public {
        bytes memory commands = hex"ff";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = "";
        vm.expectRevert(DogeOSAggregationRouter.UnknownCommand.selector);
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_pause_blocksExecuteAndIsGuardianGated() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(DogeOSAggregationRouter.Unauthorized.selector);
        router.pause();

        vm.prank(guardian);
        router.pause();

        bytes memory commands = hex"08";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(0), address(this));
        vm.expectRevert(); // Pausable: EnforcedPause
        router.execute(commands, inputs, block.timestamp + 1);

        vm.prank(guardian);
        vm.expectRevert(DogeOSAggregationRouter.Unauthorized.selector);
        router.unpause(); // only owner can unpause

        vm.prank(owner);
        router.unpause();
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd packages/contracts && forge test --match-contract RouterSkeletonTest`
Expected: FAIL (router contract does not exist).

- [ ] **Step 3: Write the skeleton contract**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "openzeppelin/access/Ownable2Step.sol";
import {Pausable} from "openzeppelin/utils/Pausable.sol";
import {ReentrancyGuard} from "openzeppelin/utils/ReentrancyGuard.sol";
// If Task 0.1 confirmed Cancun, swap the line above for:
// import {ReentrancyGuardTransient as ReentrancyGuard} from "openzeppelin/utils/ReentrancyGuardTransient.sol";
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {Commands} from "./libraries/Commands.sol";
import {Constants} from "./libraries/Constants.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";
import {IUniswapV3SwapRouter} from "./interfaces/IUniswapV3SwapRouter.sol";
import {IAlgebraSwapRouter} from "./interfaces/IAlgebraSwapRouter.sol";

/// @title DogeOSAggregationRouter
/// @notice Immutable command/executor router for atomic swaps on DogeOS.
contract DogeOSAggregationRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- immutables ---
    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(Constants.PERMIT2);
    address public immutable WDOGE;
    address public immutable MUCHFI_V2_ROUTER;
    address public immutable MUCHFI_V3_ROUTER;
    address public immutable BARKSWAP_ALGEBRA_ROUTER;

    // --- governance-tunable ---
    address public guardian;
    uint256 public feeBps;                       // <= MAX_FEE_BPS, default 0
    address public feeRecipient;
    mapping(address => uint256) public maxInputPerTx; // 0 == uncapped (guarded launch)

    // --- errors ---
    error DeadlineExpired();
    error LengthMismatch();
    error UnknownCommand();
    error Unauthorized();
    error FeeTooHigh();
    error NotionalCapExceeded();
    error MinOutNotMet();
    error InvalidSpender();
    error NativeTransferFailed();

    // --- events ---
    event GuardianUpdated(address indexed guardian);
    event FeeUpdated(uint256 feeBps, address indexed feeRecipient);
    event MaxInputUpdated(address indexed token, uint256 maxAmount);
    event Swapped(address indexed sender, address indexed recipient);

    constructor(
        address owner_,
        address guardian_,
        address wdoge_,
        address muchfiV2Router_,
        address muchfiV3Router_,
        address barkswapAlgebraRouter_
    ) Ownable(owner_) {
        guardian = guardian_;
        WDOGE = wdoge_;
        MUCHFI_V2_ROUTER = muchfiV2Router_;
        MUCHFI_V3_ROUTER = muchfiV3Router_;
        BARKSWAP_ALGEBRA_ROUTER = barkswapAlgebraRouter_;
    }

    receive() external payable {
        // Only accept native from WDOGE (unwrap) — never arbitrary senders.
        if (msg.sender != WDOGE) revert Unauthorized();
    }

    // --- admin ---
    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    function setFee(uint256 feeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > Constants.MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }

    function setMaxInputPerTx(address token, uint256 maxAmount) external onlyOwner {
        maxInputPerTx[token] = maxAmount;
        emit MaxInputUpdated(token, maxAmount);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert Unauthorized();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- core ---
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
        whenNotPaused
        nonReentrant
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256 n = commands.length;
        if (inputs.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; ) {
            _dispatch(commands[i], inputs[i], deadline);
            unchecked { ++i; }
        }
        emit Swapped(msg.sender, msg.sender);
    }

    function _dispatch(bytes1 command, bytes calldata input, uint256 deadline) internal {
        if (command == Commands.PERMIT2_PERMIT) { _permit2Permit(input); }
        else if (command == Commands.PERMIT2_TRANSFER_FROM) { _permit2TransferFrom(input); }
        else if (command == Commands.V2_SWAP) { _v2Swap(input, deadline); }
        else if (command == Commands.V3_SWAP) { _v3Swap(input); }
        else if (command == Commands.ALGEBRA_SWAP) { _algebraSwap(input, deadline); }
        else if (command == Commands.WRAP_NATIVE) { _wrapNative(input); }
        else if (command == Commands.UNWRAP_NATIVE) { _unwrapNative(input); }
        else if (command == Commands.PAY_FEE) { _payFee(input); }
        else if (command == Commands.SWEEP) { _sweep(input); }
        else if (command == Commands.MIN_OUT_CHECK) { _minOutCheck(input); }
        else { revert UnknownCommand(); }
    }

    // --- command handlers (implemented in later tasks; revert until then) ---
    function _permit2Permit(bytes calldata) internal pure { revert UnknownCommand(); }
    function _permit2TransferFrom(bytes calldata) internal pure { revert UnknownCommand(); }
    function _v2Swap(bytes calldata, uint256) internal pure { revert UnknownCommand(); }
    function _v3Swap(bytes calldata) internal pure { revert UnknownCommand(); }
    function _algebraSwap(bytes calldata, uint256) internal pure { revert UnknownCommand(); }
    function _wrapNative(bytes calldata) internal pure { revert UnknownCommand(); }
    function _unwrapNative(bytes calldata) internal pure { revert UnknownCommand(); }
    function _payFee(bytes calldata) internal pure { revert UnknownCommand(); }

    function _sweep(bytes calldata input) internal {
        (address token, address recipient) = abi.decode(input, (address, address));
        if (token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal > 0) {
                (bool ok, ) = recipient.call{value: bal}("");
                if (!ok) revert NativeTransferFailed();
            }
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) IERC20(token).safeTransfer(recipient, bal);
        }
    }

    function _minOutCheck(bytes calldata input) internal view {
        (address token, uint256 minOut) = abi.decode(input, (address, uint256));
        uint256 bal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        if (bal < minOut) revert MinOutNotMet();
    }
}
```

> `_sweep` and `_minOutCheck` are implemented here because the skeleton tests exercise `SWEEP`. The remaining handlers revert with `UnknownCommand` until their tasks. (When you reach Cancun, switching to `ReentrancyGuardTransient` requires no other change.)

- [ ] **Step 4: Run the tests**

Run: `cd packages/contracts && forge test --match-contract RouterSkeletonTest -vvv`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/DogeOSAggregationRouter.t.sol
git commit -m "feat(contracts): router skeleton with dispatch, access control, sweep, minout"
```

### Task 1.3: Permit2 pull + notional cap

**Files:**
- Create: `packages/contracts/test/mocks/MockERC20.sol`
- Create: `packages/contracts/test/utils/PermitSignature.sol`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (implement `_permit2Permit`, `_permit2TransferFrom`)
- Create: `packages/contracts/test/RouterPermit2.t.sol`

- [ ] **Step 1: Write `MockERC20.sol`** (supports standard, fee-on-transfer, and non-returning-`approve` modes)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract MockERC20 {
    string public name; string public symbol; uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public feeBps;          // fee-on-transfer (basis points), 0 = none
    bool public approveReturnsVoid; // simulate USDT-style no-return approve

    constructor(string memory n, string memory s) { name = n; symbol = s; }

    function setFeeBps(uint256 b) external { feeBps = b; }
    function setApproveReturnsVoid(bool v) external { approveReturnsVoid = v; }
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; totalSupply += amt; }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        if (approveReturnsVoid) { assembly { return(0, 0) } }
        return true;
    }

    function transfer(address to, uint256 amt) public returns (bool) {
        return _transfer(msg.sender, to, amt);
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) { require(a >= amt, "allowance"); allowance[from][msg.sender] = a - amt; }
        return _transfer(from, to, amt);
    }

    function _transfer(address from, address to, uint256 amt) internal returns (bool) {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        uint256 fee = (amt * feeBps) / 10_000;
        balanceOf[to] += (amt - fee);
        if (fee > 0) { balanceOf[address(0xdead)] += fee; }
        return true;
    }
}
```

- [ ] **Step 2: Write `PermitSignature.sol`** (EIP-712 helper, from the verified Permit2 pattern)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";

contract PermitSignature {
    bytes32 public constant _PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 public constant _PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );

    function getPermitSignature(
        IAllowanceTransfer.PermitSingle memory permit,
        uint256 privateKey,
        bytes32 domainSeparator,
        Vm vm
    ) internal pure returns (bytes memory sig) {
        bytes32 detailsHash = keccak256(abi.encode(_PERMIT_DETAILS_TYPEHASH, permit.details));
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(abi.encode(_PERMIT_SINGLE_TYPEHASH, detailsHash, permit.spender, permit.sigDeadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return bytes.concat(r, s, bytes1(v));
    }
}
```

- [ ] **Step 3: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterPermit2Test is Test, DeployPermit2, PermitSignature {
    DogeOSAggregationRouter router;
    IAllowanceTransfer permit2;
    MockERC20 token;
    address owner = makeAddr("owner");
    address user; uint256 userPk;

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2()); // etches Permit2 at canonical addr
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), makeAddr("v2"), makeAddr("v3"), makeAddr("alg"));
        token = new MockERC20("Tok", "TOK");
        (user, userPk) = makeAddrAndKey("user");
        token.mint(user, 1_000 ether);
        vm.prank(user);
        token.approve(address(permit2), type(uint256).max); // one-time ERC20 approval to Permit2
    }

    function _permitSingle(uint160 amount) internal view returns (IAllowanceTransfer.PermitSingle memory) {
        return IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(token), amount: amount,
                expiration: uint48(block.timestamp + 1 days), nonce: 0
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
    }

    function test_permitAndTransferFrom_pullsFunds() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(100 ether));
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);

        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01)); // PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(user, p, sig);
        inputs[1] = abi.encode(user, address(token), uint160(100 ether));

        vm.prank(user);
        router.execute(commands, inputs, block.timestamp + 1);

        assertEq(token.balanceOf(address(router)), 100 ether);
        assertEq(token.balanceOf(user), 900 ether);
    }

    function test_transferFrom_revertsOverNotionalCap() public {
        vm.prank(owner);
        router.setMaxInputPerTx(address(token), 50 ether);

        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(100 ether));
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);
        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(user, p, sig);
        inputs[1] = abi.encode(user, address(token), uint160(100 ether));

        vm.prank(user);
        vm.expectRevert(DogeOSAggregationRouter.NotionalCapExceeded.selector);
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_permit_rejectsForeignSpender() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(100 ether));
        p.spender = makeAddr("attacker"); // spender != router
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);
        bytes memory commands = abi.encodePacked(bytes1(0x00));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(user, p, sig);
        vm.prank(user);
        vm.expectRevert(DogeOSAggregationRouter.InvalidSpender.selector);
        router.execute(commands, inputs, block.timestamp + 1);
    }
}
```

- [ ] **Step 4: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterPermit2Test`
Expected: FAIL (`_permit2Permit`/`_permit2TransferFrom` still revert `UnknownCommand`).

- [ ] **Step 5: Implement the handlers** (replace the two stubs in `DogeOSAggregationRouter.sol`)

```solidity
    function _permit2Permit(bytes calldata input) internal {
        (address owner_, IAllowanceTransfer.PermitSingle memory permitSingle, bytes memory signature) =
            abi.decode(input, (address, IAllowanceTransfer.PermitSingle, bytes));
        // Never let a signed permit authorize anyone but this router.
        if (permitSingle.spender != address(this)) revert InvalidSpender();
        PERMIT2.permit(owner_, permitSingle, signature);
    }

    function _permit2TransferFrom(bytes calldata input) internal {
        (address owner_, address token, uint160 amount) = abi.decode(input, (address, address, uint160));
        uint256 cap = maxInputPerTx[token];
        if (cap != 0 && amount > cap) revert NotionalCapExceeded();
        PERMIT2.transferFrom(owner_, address(this), amount, token);
    }
```

Remove the corresponding `pure` stub declarations for these two functions.

- [ ] **Step 6: Run the tests**

Run: `cd packages/contracts && forge test --match-contract RouterPermit2Test -vvv`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/RouterPermit2.t.sol packages/contracts/test/mocks/MockERC20.sol packages/contracts/test/utils/PermitSignature.sol
git commit -m "feat(contracts): permit2 allowance-transfer pull with notional cap"
```

### Task 1.4: Native wrap/unwrap + fee

**Files:**
- Create: `packages/contracts/test/mocks/MockWDOGE.sol`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (implement `_wrapNative`, `_unwrapNative`, `_payFee`)
- Create: `packages/contracts/test/RouterPayments.t.sol`

- [ ] **Step 1: Write `MockWDOGE.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract MockWDOGE {
    string public name = "Wrapped Doge"; string public symbol = "WDOGE"; uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() public payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 amt) external {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "send");
    }
    receive() external payable { deposit(); }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { return _t(msg.sender, to, a); }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) { require(al >= a, "al"); allowance[f][msg.sender] = al - a; }
        return _t(f, to, a);
    }
    function _t(address f, address to, uint256 a) internal returns (bool) {
        require(balanceOf[f] >= a, "bal"); balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}
```

- [ ] **Step 2: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {MockWDOGE} from "./mocks/MockWDOGE.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract RouterPaymentsTest is Test {
    DogeOSAggregationRouter router;
    MockWDOGE wdoge;
    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("fee");

    function setUp() public {
        wdoge = new MockWDOGE();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), address(wdoge), makeAddr("v2"), makeAddr("v3"), makeAddr("alg"));
    }

    function test_wrapAndUnwrapAndSweepNative() public {
        // commands: WRAP_NATIVE(full), UNWRAP_NATIVE(full), SWEEP native -> user
        address user = makeAddr("user");
        vm.deal(user, 5 ether);
        bytes memory commands = abi.encodePacked(bytes1(0x05), bytes1(0x06), bytes1(0x08));
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(type(uint256).max);              // wrap full msg.value
        inputs[1] = abi.encode(type(uint256).max);              // unwrap full WDOGE balance
        inputs[2] = abi.encode(address(0), user);              // sweep native to user
        vm.prank(user);
        router.execute{value: 5 ether}(commands, inputs, block.timestamp + 1);
        assertEq(user.balance, 5 ether);
        assertEq(address(router).balance, 0);
    }

    function test_payFee_takesConfiguredBps() public {
        MockERC20 token = new MockERC20("T","T");
        token.mint(address(router), 100 ether);
        vm.prank(owner);
        router.setFee(50, feeRecipient); // 0.5%

        bytes memory commands = abi.encodePacked(bytes1(0x07)); // PAY_FEE
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(token));
        router.execute(commands, inputs, block.timestamp + 1);

        assertEq(token.balanceOf(feeRecipient), 0.5 ether);
        assertEq(token.balanceOf(address(router)), 99.5 ether);
    }

    function test_payFee_noopWhenZero() public {
        MockERC20 token = new MockERC20("T","T");
        token.mint(address(router), 100 ether);
        bytes memory commands = abi.encodePacked(bytes1(0x07));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(token));
        router.execute(commands, inputs, block.timestamp + 1);
        assertEq(token.balanceOf(address(router)), 100 ether);
    }
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterPaymentsTest`
Expected: FAIL (handlers revert).

- [ ] **Step 4: Implement the handlers** (replace stubs; add an internal `_resolveAmount` helper)

```solidity
    function _resolveAmount(uint256 amount, address token) internal view returns (uint256) {
        if (amount == Constants.CONTRACT_BALANCE) {
            return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        }
        return amount;
    }

    function _wrapNative(bytes calldata input) internal {
        uint256 amount = abi.decode(input, (uint256));
        amount = _resolveAmount(amount, address(0));
        IWETH9(WDOGE).deposit{value: amount}();
    }

    function _unwrapNative(bytes calldata input) internal {
        uint256 amount = abi.decode(input, (uint256));
        amount = _resolveAmount(amount, WDOGE);
        IWETH9(WDOGE).withdraw(amount);
    }

    function _payFee(bytes calldata input) internal {
        uint256 bps = feeBps;
        if (bps == 0) return;
        address token = abi.decode(input, (address));
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 fee = (bal * bps) / Constants.BPS_DENOMINATOR;
        if (fee > 0) IERC20(token).safeTransfer(feeRecipient, fee);
    }
```

Remove the matching `pure` stubs.

- [ ] **Step 5: Run the tests**

Run: `cd packages/contracts && forge test --match-contract RouterPaymentsTest -vvv`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/RouterPayments.t.sol packages/contracts/test/mocks/MockWDOGE.sol
git commit -m "feat(contracts): native wrap/unwrap + capped protocol fee"
```

---

## Phase 2 — Venue swap commands

### Task 2.1: V2_SWAP

**Files:**
- Create: `packages/contracts/test/mocks/MockV2Router.sol`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (implement `_v2Swap` + `_approveVenue` helper)
- Create: `packages/contracts/test/RouterV2Swap.t.sol`

- [ ] **Step 1: Write `MockV2Router.sol`** (pulls `amountIn` of `path[0]`, sends `amountIn * rateBps/10000` of `path[last]`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

contract MockV2Router {
    uint256 public rateBps = 9_900; // 1% "slippage" by default

    function setRateBps(uint256 r) external { rateBps = r; }

    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * rateBps) / 10_000;
        require(out >= amountOutMin, "V2: INSUFFICIENT_OUTPUT");
        MockERC20(path[path.length - 1]).mint(to, out);
        amounts = new uint256[](2); amounts[0] = amountIn; amounts[1] = out;
    }
}
```

- [ ] **Step 2: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV2Router} from "./mocks/MockV2Router.sol";

contract RouterV2SwapTest is Test {
    DogeOSAggregationRouter router;
    MockV2Router v2;
    MockERC20 tokenIn; MockERC20 tokenOut;
    address owner = makeAddr("owner");

    function setUp() public {
        v2 = new MockV2Router();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), address(v2), makeAddr("v3"), makeAddr("alg"));
        tokenIn = new MockERC20("IN","IN"); tokenOut = new MockERC20("OUT","OUT");
        tokenIn.mint(address(router), 100 ether); // simulate post-Permit2 balance
    }

    function test_v2Swap_swapsFullBalance() public {
        address[] memory path = new address[](2);
        path[0] = address(tokenIn); path[1] = address(tokenOut);
        bytes memory commands = abi.encodePacked(bytes1(0x02)); // V2_SWAP
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(type(uint256).max, uint256(98 ether), path); // amountIn=full, minOut
        router.execute(commands, inputs, block.timestamp + 1);
        assertEq(tokenOut.balanceOf(address(router)), 99 ether);
        assertEq(tokenIn.balanceOf(address(router)), 0);
    }

    function test_v2Swap_respectsPerLegMinOut() public {
        v2.setRateBps(9_000); // 10% out
        address[] memory path = new address[](2);
        path[0] = address(tokenIn); path[1] = address(tokenOut);
        bytes memory commands = abi.encodePacked(bytes1(0x02));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(type(uint256).max, uint256(95 ether), path);
        vm.expectRevert(bytes("V2: INSUFFICIENT_OUTPUT"));
        router.execute(commands, inputs, block.timestamp + 1);
    }
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterV2SwapTest`
Expected: FAIL.

- [ ] **Step 4: Implement `_approveVenue` + `_v2Swap`** (replace the `_v2Swap` stub; add the helper)

```solidity
    /// @dev Lazily grant the (trusted, immutable) venue a max allowance of `token`.
    function _approveVenue(address token, address venue, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), venue) < amount) {
            IERC20(token).forceApprove(venue, type(uint256).max);
        }
    }

    function _v2Swap(bytes calldata input, uint256 deadline) internal {
        (uint256 amountIn, uint256 amountOutMin, address[] memory path) =
            abi.decode(input, (uint256, uint256, address[]));
        amountIn = _resolveAmount(amountIn, path[0]);
        _approveVenue(path[0], MUCHFI_V2_ROUTER, amountIn);
        IUniswapV2Router(MUCHFI_V2_ROUTER).swapExactTokensForTokens(
            amountIn, amountOutMin, path, address(this), deadline
        );
    }
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/contracts && forge test --match-contract RouterV2SwapTest -vvv`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/RouterV2Swap.t.sol packages/contracts/test/mocks/MockV2Router.sol
git commit -m "feat(contracts): V2_SWAP command via immutable MuchFi V2 router"
```

### Task 2.2: V3_SWAP

**Files:**
- Create: `packages/contracts/test/mocks/MockV3Router.sol`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (implement `_v3Swap`)
- Create: `packages/contracts/test/RouterV3Swap.t.sol`

- [ ] **Step 1: Write `MockV3Router.sol`** (SwapRouter02 struct — no deadline)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";
import {IUniswapV3SwapRouter} from "../../src/interfaces/IUniswapV3SwapRouter.sol";

contract MockV3Router {
    uint256 public rateBps = 9_950;
    function setRateBps(uint256 r) external { rateBps = r; }

    function exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams calldata p)
        external payable returns (uint256 amountOut)
    {
        MockERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * rateBps) / 10_000;
        require(amountOut >= p.amountOutMinimum, "V3: TOO_LITTLE_RECEIVED");
        MockERC20(p.tokenOut).mint(p.recipient, amountOut);
    }
}
```

- [ ] **Step 2: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";

contract RouterV3SwapTest is Test {
    DogeOSAggregationRouter router; MockV3Router v3;
    MockERC20 tokenIn; MockERC20 tokenOut;
    function setUp() public {
        v3 = new MockV3Router();
        router = new DogeOSAggregationRouter(makeAddr("o"), makeAddr("g"), makeAddr("w"), makeAddr("v2"), address(v3), makeAddr("alg"));
        tokenIn = new MockERC20("IN","IN"); tokenOut = new MockERC20("OUT","OUT");
        tokenIn.mint(address(router), 100 ether);
    }
    function test_v3Swap_swapsFullBalance() public {
        bytes memory commands = abi.encodePacked(bytes1(0x03)); // V3_SWAP
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(tokenIn), address(tokenOut), uint24(500), type(uint256).max, uint256(99 ether));
        router.execute(commands, inputs, block.timestamp + 1);
        assertEq(tokenOut.balanceOf(address(router)), 99.5 ether);
        assertEq(tokenIn.balanceOf(address(router)), 0);
    }
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterV3SwapTest`
Expected: FAIL.

- [ ] **Step 4: Implement `_v3Swap`** (replace stub)

```solidity
    function _v3Swap(bytes calldata input) internal {
        (address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMin) =
            abi.decode(input, (address, address, uint24, uint256, uint256));
        amountIn = _resolveAmount(amountIn, tokenIn);
        _approveVenue(tokenIn, MUCHFI_V3_ROUTER, amountIn);
        IUniswapV3SwapRouter(MUCHFI_V3_ROUTER).exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: address(this),
                amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0
            })
        );
    }
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/contracts && forge test --match-contract RouterV3SwapTest -vvv`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/RouterV3Swap.t.sol packages/contracts/test/mocks/MockV3Router.sol
git commit -m "feat(contracts): V3_SWAP command via immutable MuchFi V3 router"
```

### Task 2.3: ALGEBRA_SWAP

**Files:**
- Create: `packages/contracts/test/mocks/MockAlgebraRouter.sol`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (implement `_algebraSwap`)
- Create: `packages/contracts/test/RouterAlgebraSwap.t.sol`

- [ ] **Step 1: Write `MockAlgebraRouter.sol`** (Integral struct — has deployer + deadline)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";
import {IAlgebraSwapRouter} from "../../src/interfaces/IAlgebraSwapRouter.sol";

contract MockAlgebraRouter {
    uint256 public rateBps = 9_960;
    address public lastDeployer;
    function exactInputSingle(IAlgebraSwapRouter.ExactInputSingleParams calldata p)
        external payable returns (uint256 amountOut)
    {
        lastDeployer = p.deployer;
        MockERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * rateBps) / 10_000;
        require(amountOut >= p.amountOutMinimum, "ALG: TOO_LITTLE");
        MockERC20(p.tokenOut).mint(p.recipient, amountOut);
    }
}
```

- [ ] **Step 2: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAlgebraRouter} from "./mocks/MockAlgebraRouter.sol";

contract RouterAlgebraSwapTest is Test {
    DogeOSAggregationRouter router; MockAlgebraRouter alg;
    MockERC20 tokenIn; MockERC20 tokenOut;
    address deployer = makeAddr("poolDeployer");
    function setUp() public {
        alg = new MockAlgebraRouter();
        router = new DogeOSAggregationRouter(makeAddr("o"), makeAddr("g"), makeAddr("w"), makeAddr("v2"), makeAddr("v3"), address(alg));
        tokenIn = new MockERC20("IN","IN"); tokenOut = new MockERC20("OUT","OUT");
        tokenIn.mint(address(router), 100 ether);
    }
    function test_algebraSwap_passesDeployerAndSwaps() public {
        bytes memory commands = abi.encodePacked(bytes1(0x04)); // ALGEBRA_SWAP
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(tokenIn), address(tokenOut), deployer, type(uint256).max, uint256(99 ether));
        router.execute(commands, inputs, block.timestamp + 1);
        assertEq(tokenOut.balanceOf(address(router)), 99.6 ether);
        assertEq(alg.lastDeployer(), deployer);
    }
}
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterAlgebraSwapTest`
Expected: FAIL.

- [ ] **Step 4: Implement `_algebraSwap`** (replace stub)

```solidity
    function _algebraSwap(bytes calldata input, uint256 deadline) internal {
        (address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint256 amountOutMin) =
            abi.decode(input, (address, address, address, uint256, uint256));
        amountIn = _resolveAmount(amountIn, tokenIn);
        _approveVenue(tokenIn, BARKSWAP_ALGEBRA_ROUTER, amountIn);
        IAlgebraSwapRouter(BARKSWAP_ALGEBRA_ROUTER).exactInputSingle(
            IAlgebraSwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn, tokenOut: tokenOut, deployer: deployer, recipient: address(this),
                deadline: deadline, amountIn: amountIn, amountOutMinimum: amountOutMin, limitSqrtPrice: 0
            })
        );
    }
```

- [ ] **Step 5: Run the tests + full suite**

Run: `cd packages/contracts && forge test -vvv`
Expected: PASS (all suites so far).

- [ ] **Step 6: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/DogeOSAggregationRouter.sol packages/contracts/test/RouterAlgebraSwap.t.sol packages/contracts/test/mocks/MockAlgebraRouter.sol
git commit -m "feat(contracts): ALGEBRA_SWAP command via immutable Barkswap router"
```

---

## Phase 3 — Integration, splits/multi-hop, invariants, negatives

### Task 3.1: End-to-end single swap (Permit2 → V3 → fee → minout → sweep)

**Files:**
- Create: `packages/contracts/test/RouterExecute.integration.t.sol`

- [ ] **Step 1: Write the test** (full program; reuses `DeployPermit2`, `PermitSignature`, mocks)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterExecuteIntegrationTest is Test, DeployPermit2, PermitSignature {
    DogeOSAggregationRouter router; IAllowanceTransfer permit2; MockV3Router v3;
    MockERC20 tin; MockERC20 tout;
    address owner = makeAddr("owner"); address feeRecipient = makeAddr("fee");
    address user; uint256 userPk; address recipient = makeAddr("recipient");

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        v3 = new MockV3Router();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), makeAddr("v2"), address(v3), makeAddr("alg"));
        tin = new MockERC20("IN","IN"); tout = new MockERC20("OUT","OUT");
        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, 1_000 ether);
        vm.prank(user); tin.approve(address(permit2), type(uint256).max);
        vm.prank(owner); router.setFee(30, feeRecipient); // 0.3%
    }

    function test_endToEnd_singleSwap_userReceivesNetMinusFee() public {
        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({token: address(tin), amount: uint160(100 ether), expiration: uint48(block.timestamp + 1 days), nonce: 0}),
            spender: address(router), sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);

        bytes memory commands = abi.encodePacked(
            bytes1(0x00), bytes1(0x01), bytes1(0x03), bytes1(0x07), bytes1(0x09), bytes1(0x08)
        ); // PERMIT, TRANSFER_FROM, V3_SWAP, PAY_FEE, MIN_OUT_CHECK, SWEEP
        bytes[] memory inputs = new bytes[](6);
        inputs[0] = abi.encode(user, p, sig);
        inputs[1] = abi.encode(user, address(tin), uint160(100 ether));
        inputs[2] = abi.encode(address(tin), address(tout), uint24(500), type(uint256).max, uint256(99 ether));
        inputs[3] = abi.encode(address(tout));
        // 99.5 out, minus 0.3% fee = 99.2015; require user nets >= 99 ether
        inputs[4] = abi.encode(address(tout), uint256(99 ether));
        inputs[5] = abi.encode(address(tout), recipient);

        vm.prank(user);
        router.execute(commands, inputs, block.timestamp + 1);

        uint256 grossOut = 99.5 ether;
        uint256 fee = (grossOut * 30) / 10_000;
        assertEq(tout.balanceOf(recipient), grossOut - fee);
        assertEq(tout.balanceOf(feeRecipient), fee);
        assertEq(tout.balanceOf(address(router)), 0); // I1: zero residual
        assertEq(tin.balanceOf(address(router)), 0);
    }
}
```

- [ ] **Step 2: Run**

Run: `cd packages/contracts && forge test --match-contract RouterExecuteIntegrationTest -vvv`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/test/RouterExecute.integration.t.sol
git commit -m "test(contracts): end-to-end single-swap integration"
```

### Task 3.2: Split + multi-hop atomic execution

**Files:**
- Modify: `packages/contracts/test/RouterExecute.integration.t.sol` (add two tests)

- [ ] **Step 1: Add the split test** (one input token, two venues, one output token, single MIN_OUT_CHECK + SWEEP)

```solidity
    function test_split_acrossV3andV2_singleMinOutAndSweep() public {
        // Add a V2 venue by redeploying router with both venues wired.
        MockV2RouterLocal v2 = new MockV2RouterLocal();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), address(v2), address(v3), makeAddr("alg"));
        vm.prank(owner); router.setFee(0, address(0));
        // fund router directly to isolate split logic
        tin.mint(address(router), 100 ether);

        address[] memory path = new address[](2);
        path[0] = address(tin); path[1] = address(tout);

        bytes memory commands = abi.encodePacked(
            bytes1(0x03), bytes1(0x02), bytes1(0x09), bytes1(0x08)
        ); // V3_SWAP (60), V2_SWAP (rest), MIN_OUT_CHECK, SWEEP
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = abi.encode(address(tin), address(tout), uint24(500), uint256(60 ether), uint256(0));
        inputs[1] = abi.encode(type(uint256).max, uint256(0), path); // remaining 40
        inputs[2] = abi.encode(address(tout), uint256(95 ether));
        inputs[3] = abi.encode(address(tout), recipient);

        router.execute(commands, inputs, block.timestamp + 1);
        // 60 * 0.995 + 40 * 0.99 = 59.7 + 39.6 = 99.3
        assertEq(tout.balanceOf(recipient), 99.3 ether);
        assertEq(tin.balanceOf(address(router)), 0);
    }
```

Add this helper mock import-free contract at the bottom of the test file:

```solidity
contract MockV2RouterLocal {
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256) external returns (uint256[] memory amounts) {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * 9_900) / 10_000;
        require(out >= amountOutMin, "V2 out");
        MockERC20(path[path.length-1]).mint(to, out);
        amounts = new uint256[](2); amounts[0]=amountIn; amounts[1]=out;
    }
}
```

- [ ] **Step 2: Add the multi-hop test** (tin → mid → tout through two V3 hops)

```solidity
    function test_multiHop_chainsTwoSwaps() public {
        MockERC20 mid = new MockERC20("MID","MID");
        tin.mint(address(router), 100 ether);
        bytes memory commands = abi.encodePacked(bytes1(0x03), bytes1(0x03), bytes1(0x09), bytes1(0x08));
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = abi.encode(address(tin), address(mid), uint24(500), type(uint256).max, uint256(0));   // hop 1: tin->mid (full)
        inputs[1] = abi.encode(address(mid), address(tout), uint24(500), type(uint256).max, uint256(0));  // hop 2: mid->tout (full)
        inputs[2] = abi.encode(address(tout), uint256(98 ether));
        inputs[3] = abi.encode(address(tout), recipient);
        router.execute(commands, inputs, block.timestamp + 1);
        // 100 * 0.995 * 0.995 = 99.0025
        assertEq(tout.balanceOf(recipient), 99.0025 ether);
        assertEq(mid.balanceOf(address(router)), 0);
    }
```

- [ ] **Step 3: Run**

Run: `cd packages/contracts && forge test --match-contract RouterExecuteIntegrationTest -vvv`
Expected: PASS (3 tests total).

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/test/RouterExecute.integration.t.sol
git commit -m "test(contracts): atomic split + multi-hop execution"
```

### Task 3.3: Invariant suite (I1–I8)

**Files:**
- Create: `packages/contracts/test/handlers/RouterHandler.sol`
- Create: `packages/contracts/test/RouterInvariants.t.sol`

- [ ] **Step 1: Write the handler** (bounds inputs, performs Permit2 swaps, tracks ghost vars)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeOSAggregationRouter} from "../../src/DogeOSAggregationRouter.sol";
import {Constants} from "../../src/libraries/Constants.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockV3Router} from "../mocks/MockV3Router.sol";
import {PermitSignature} from "../utils/PermitSignature.sol";

contract RouterHandler is Test, PermitSignature {
    DogeOSAggregationRouter public router;
    MockERC20 public tin; MockERC20 public tout; MockV3Router public v3;
    address public user; uint256 internal userPk; address public recipient;
    address public feeRecipient;

    uint256 public ghost_pulled;       // total tin pulled from user
    uint256 public ghost_recipientOut; // total tout delivered to recipient
    uint256 public ghost_feeOut;       // total tout sent to feeRecipient
    uint48  internal nonce;

    constructor(DogeOSAggregationRouter r, MockERC20 _tin, MockERC20 _tout, MockV3Router _v3, address _user, uint256 _pk, address _recip, address _fee) {
        router = r; tin = _tin; tout = _tout; v3 = _v3; user = _user; userPk = _pk; recipient = _recip; feeRecipient = _fee;
    }

    function swap(uint256 amount) external {
        amount = bound(amount, 1e15, 50 ether);
        if (tin.balanceOf(user) < amount) return;

        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({token: address(tin), amount: uint160(amount), expiration: uint48(block.timestamp + 1 days), nonce: nonce}),
            spender: address(router), sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);

        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01), bytes1(0x03), bytes1(0x07), bytes1(0x08), bytes1(0x08));
        bytes[] memory inputs = new bytes[](6);
        inputs[0] = abi.encode(user, p, sig);
        inputs[1] = abi.encode(user, address(tin), uint160(amount));
        inputs[2] = abi.encode(address(tin), address(tout), uint24(500), type(uint256).max, uint256(0));
        inputs[3] = abi.encode(address(tout));
        inputs[4] = abi.encode(address(tout), recipient);   // sweep out -> recipient
        inputs[5] = abi.encode(address(tin), user);         // refund any residual tin

        uint256 recipBefore = tout.balanceOf(recipient);
        uint256 feeBefore = tout.balanceOf(feeRecipient);
        vm.prank(user);
        router.execute(commands, inputs, block.timestamp + 1);

        nonce++;
        ghost_pulled += amount;
        ghost_recipientOut += tout.balanceOf(recipient) - recipBefore;
        ghost_feeOut += tout.balanceOf(feeRecipient) - feeBefore;
    }
}
```

- [ ] **Step 2: Write the invariant test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {RouterHandler} from "./handlers/RouterHandler.sol";

contract RouterInvariantsTest is Test, DeployPermit2 {
    DogeOSAggregationRouter router; RouterHandler handler;
    MockERC20 tin; MockERC20 tout; MockV3Router v3;
    address owner = makeAddr("owner"); address feeRecipient = makeAddr("fee");
    address user; uint256 userPk; address recipient = makeAddr("recipient");

    function setUp() public {
        deployPermit2();
        v3 = new MockV3Router();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), makeAddr("v2"), address(v3), makeAddr("alg"));
        tin = new MockERC20("IN","IN"); tout = new MockERC20("OUT","OUT");
        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, 1_000_000 ether);
        vm.prank(user); tin.approve(address(0x000000000022D473030F116dDEE9F6B43aC78BA3), type(uint256).max);
        vm.prank(owner); router.setFee(30, feeRecipient);

        handler = new RouterHandler(router, tin, tout, v3, user, userPk, recipient, feeRecipient);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](1);
        sel[0] = RouterHandler.swap.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// I1: router never accrues token balances between transactions.
    function invariant_I1_zeroResidualBalances() public view {
        assertEq(tin.balanceOf(address(router)), 0);
        assertEq(tout.balanceOf(address(router)), 0);
    }

    /// I3: the user never spends more than was pulled (sum of pulls == tin leaving user).
    function invariant_I3_userSpendBounded() public view {
        assertEq(handler.ghost_pulled(), 1_000_000 ether - tin.balanceOf(user));
    }

    /// I4: fee never exceeds feeBps of gross; only feeRecipient receives fees.
    function invariant_I4_feeBounded() public view {
        uint256 gross = handler.ghost_recipientOut() + handler.ghost_feeOut();
        assertLe(handler.ghost_feeOut() * 10_000, gross * 30 + 1e6); // <= 0.30% (+rounding slack)
    }
}
```

- [ ] **Step 3: Run**

Run: `cd packages/contracts && forge test --match-contract RouterInvariantsTest -vvv`
Expected: PASS (invariants hold across fuzz runs).

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/test/RouterInvariants.t.sol packages/contracts/test/handlers/RouterHandler.sol
git commit -m "test(contracts): invariant suite (I1 residual, I3 spend, I4 fee)"
```

### Task 3.4: Negative / abuse tests

**Files:**
- Create: `packages/contracts/test/RouterNegative.t.sol`

- [ ] **Step 1: Write the tests** (replay, expired permit, paused, min-out breach, fee-on-transfer accounting, native refund safety)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterNegativeTest is Test, DeployPermit2, PermitSignature {
    DogeOSAggregationRouter router; IAllowanceTransfer permit2; MockV3Router v3;
    MockERC20 tin; MockERC20 tout;
    address owner = makeAddr("owner"); address user; uint256 userPk; address recipient = makeAddr("r");

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        v3 = new MockV3Router();
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), makeAddr("w"), makeAddr("v2"), address(v3), makeAddr("alg"));
        tin = new MockERC20("IN","IN"); tout = new MockERC20("OUT","OUT");
        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, 1_000 ether);
        vm.prank(user); tin.approve(address(permit2), type(uint256).max);
    }

    function _signedPermit(uint48 nonce, uint256 sigDeadline) internal view returns (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) {
        p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({token: address(tin), amount: uint160(100 ether), expiration: uint48(block.timestamp + 1 days), nonce: nonce}),
            spender: address(router), sigDeadline: sigDeadline
        });
        sig = getPermitSignature(p, userPk, IEIP712(Constants.PERMIT2).DOMAIN_SEPARATOR(), vm);
    }

    function test_replay_secondUseOfSameNonceReverts() public {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) = _signedPermit(0, block.timestamp + 1 hours);
        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(user, p, sig);
        inputs[1] = abi.encode(user, address(tin), uint160(100 ether));
        vm.prank(user); router.execute(commands, inputs, block.timestamp + 1);
        // re-submitting the same nonce-0 permit must revert (Permit2 ordered nonce)
        vm.prank(user); vm.expectRevert();
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_expiredSigDeadline_reverts() public {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) = _signedPermit(0, block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        bytes memory commands = abi.encodePacked(bytes1(0x00));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(user, p, sig);
        vm.prank(user); vm.expectRevert();
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_paused_blocksExecute() public {
        vm.prank(owner); router.pause();
        bytes memory commands = abi.encodePacked(bytes1(0x08));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(0), user);
        vm.prank(user); vm.expectRevert();
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_minOutBreach_revertsWholeTx() public {
        tin.mint(address(router), 100 ether);
        bytes memory commands = abi.encodePacked(bytes1(0x03), bytes1(0x09));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(tin), address(tout), uint24(500), type(uint256).max, uint256(0));
        inputs[1] = abi.encode(address(tout), uint256(100 ether)); // demand more than 99.5 produced
        vm.expectRevert(DogeOSAggregationRouter.MinOutNotMet.selector);
        router.execute(commands, inputs, block.timestamp + 1);
    }

    function test_feeOnTransferToken_accountedByBalanceDelta() public {
        tout.setFeeBps(100); // 1% fee-on-transfer on the OUTPUT token
        tin.mint(address(router), 100 ether);
        bytes memory commands = abi.encodePacked(bytes1(0x03), bytes1(0x08));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(tin), address(tout), uint24(500), type(uint256).max, uint256(0));
        inputs[1] = abi.encode(address(tout), recipient);
        router.execute(commands, inputs, block.timestamp + 1);
        // router minted 99.5 OUT; sweep transfers full balance; recipient gets 99.5 * 0.99
        assertEq(tout.balanceOf(recipient), 98.505 ether);
        assertEq(tout.balanceOf(address(router)), 0);
    }

    function test_receive_rejectsNonWdogeSender() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool ok, ) = address(router).call{value: 1 ether}("");
        assertFalse(ok); // receive() reverts for non-WDOGE
    }
}
```

- [ ] **Step 2: Run**

Run: `cd packages/contracts && forge test --match-contract RouterNegativeTest -vvv`
Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/test/RouterNegative.t.sol
git commit -m "test(contracts): negative/abuse coverage (replay, expiry, pause, minout, FoT, receive)"
```

---

## Phase 4 — Trail-of-Bits security tooling

### Task 4.1: Slither

**Files:**
- Create: `packages/contracts/slither.config.json`
- Create: `packages/contracts/audit/SLITHER_TRIAGE.md`

- [ ] **Step 1: Write `slither.config.json`**

```json
{
  "filter_paths": "lib|test|script",
  "exclude_dependencies": true,
  "exclude_informational": false,
  "exclude_optimization": true,
  "fail_on": "high"
}
```

- [ ] **Step 2: Run Slither and triage**

```bash
cd packages/contracts
pip3 install slither-analyzer solc-select
solc-select install 0.8.26 && solc-select use 0.8.26
slither . 2>&1 | tee ../../slither-run.txt
```

Expected: completes; `fail_on: high` returns non-zero only on HIGH findings.

- [ ] **Step 3: Record triage**

In `audit/SLITHER_TRIAGE.md`, list each finding with: detector, location, and disposition (fixed / false-positive-with-reason / accepted). For any accepted finding, add an inline `// slither-disable-next-line <detector>` with a justifying comment in the source. There must be zero unjustified HIGH/MEDIUM findings.

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/slither.config.json packages/contracts/audit/SLITHER_TRIAGE.md packages/contracts/src/DogeOSAggregationRouter.sol
git commit -m "chore(contracts): slither config + triage to zero unjustified findings"
```

### Task 4.2: Echidna property contract

**Files:**
- Create: `packages/contracts/echidna.yaml`
- Create: `packages/contracts/test/echidna/EchidnaRouter.sol`

- [ ] **Step 1: Write `echidna.yaml`**

```yaml
testMode: assertion
testLimit: 50000
corpusDir: corpus
cryticArgs: ["--foundry-compile-all"]
```

- [ ] **Step 2: Write the assertion-mode harness** (self-contained: deploys mocks + router, asserts residual-zero after each swap)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DogeOSAggregationRouter} from "../../src/DogeOSAggregationRouter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockV3Router} from "../mocks/MockV3Router.sol";

/// @dev Assertion-mode: any failing assert() is a counterexample.
/// Funds are pre-seeded to the router to exercise swap+sweep without Permit2 signing
/// (Echidna cannot sign; Permit2 paths are covered by Foundry invariant tests).
contract EchidnaRouter {
    DogeOSAggregationRouter router;
    MockERC20 tin; MockERC20 tout; MockV3Router v3;
    address constant RECIP = address(0xBEEF);

    constructor() {
        v3 = new MockV3Router();
        router = new DogeOSAggregationRouter(address(this), address(this), address(0x1), address(0x2), address(v3), address(0x4));
        tin = new MockERC20("IN","IN"); tout = new MockERC20("OUT","OUT");
    }

    function swapAndSweep(uint256 amount) public {
        amount = amount % 100 ether + 1;
        tin.mint(address(router), amount);
        bytes memory commands = abi.encodePacked(bytes1(0x03), bytes1(0x08));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(address(tin), address(tout), uint24(500), type(uint256).max, uint256(0));
        inputs[1] = abi.encode(address(tout), RECIP);
        router.execute(commands, inputs, block.timestamp + 1);
        // I1: router holds no residual after sweep
        assert(tin.balanceOf(address(router)) == 0);
        assert(tout.balanceOf(address(router)) == 0);
    }
}
```

- [ ] **Step 3: Run Echidna**

```bash
cd packages/contracts
echidna . --contract EchidnaRouter --config echidna.yaml
```

Expected: "passed" for the assertions (no counterexample within testLimit).

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/echidna.yaml packages/contracts/test/echidna/EchidnaRouter.sol
git commit -m "test(contracts): echidna assertion harness for residual-zero invariant"
```

### Task 4.3: Medusa config

**Files:**
- Create: `packages/contracts/medusa.json`

- [ ] **Step 1: Write `medusa.json`** (reuses the same `EchidnaRouter` harness via assertion testing)

```json
{
  "fuzzing": {
    "workers": 10,
    "testLimit": 100000,
    "callSequenceLength": 50,
    "corpusDirectory": "corpus-medusa",
    "deploymentOrder": ["EchidnaRouter"],
    "targetContracts": ["EchidnaRouter"]
  },
  "testing": {
    "stopOnFailedTest": true,
    "assertionTesting": { "enabled": true },
    "propertyTesting": { "enabled": false }
  },
  "compilation": {
    "platform": "crytic-compile",
    "platformConfig": { "target": ".", "args": ["--foundry-compile-all"] }
  }
}
```

- [ ] **Step 2: Run Medusa**

```bash
cd packages/contracts
medusa fuzz --config medusa.json
```

Expected: no failing assertion test within the limit.

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/medusa.json
git commit -m "test(contracts): medusa fuzzing config"
```

### Task 4.4: CI workflow

**Files:**
- Create: `.github/workflows/contracts-security.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: contracts-security
on:
  pull_request:
    paths: ["packages/contracts/**", ".github/workflows/contracts-security.yml"]
  push:
    branches: [main]
    paths: ["packages/contracts/**"]

defaults:
  run:
    working-directory: packages/contracts

jobs:
  forge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - run: forge install foundry-rs/forge-std Uniswap/permit2 OpenZeppelin/openzeppelin-contracts --no-git
      - run: forge build --sizes
      - run: forge test -vvv
        env:
          FOUNDRY_INVARIANT_RUNS: 512
          FOUNDRY_INVARIANT_DEPTH: 200

  slither:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - run: forge install foundry-rs/forge-std Uniswap/permit2 OpenZeppelin/openzeppelin-contracts --no-git
      - uses: crytic/slither-action@v0.4.2
        with:
          target: "packages/contracts/"
          slither-config: "packages/contracts/slither.config.json"
          fail-on: "config"
```

- [ ] **Step 2: Validate locally that the commands match what CI runs**

Run: `cd packages/contracts && forge build --sizes && forge test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add .github/workflows/contracts-security.yml
git commit -m "ci(contracts): forge test + slither on PR"
```

---

## Phase 5 — Fork tests, deployment, evidence

### Task 5.1: Fork tests against live DogeOS pools (differential)

**Files:**
- Create: `packages/contracts/test/fork/RouterFork.t.sol`

- [ ] **Step 1: Write the fork test** (skips gracefully if RPC/pool unavailable; compares router output vs direct venue swap)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {DogeOSAggregationRouter} from "../../src/DogeOSAggregationRouter.sol";
import {IUniswapV3SwapRouter} from "../../src/interfaces/IUniswapV3SwapRouter.sol";

contract RouterForkTest is Test {
    // Frozen DogeOS addresses
    address constant WDOGE = 0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE;
    address constant USDC  = 0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925;
    address constant V2 = 0xC653e745FC613a03D156DACB924AE8e9148B18dc;
    address constant V3 = 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB;
    address constant ALG = 0x77147f436cE9739D2A54Ffe428DBe02b90c0205e;

    DogeOSAggregationRouter router;
    address owner = makeAddr("owner");

    function setUp() public {
        // Only run when a DogeOS RPC is configured; otherwise the suite is skipped.
        try vm.rpcUrl("dogeos") returns (string memory url) {
            vm.createSelectFork(url);
        } catch {
            vm.skip(true);
        }
        router = new DogeOSAggregationRouter(owner, makeAddr("g"), WDOGE, V2, V3, ALG);
    }

    function test_fork_v3_differential_routerVsDirect() public {
        // Skip if the fork wasn't selected.
        if (block.chainid != 6281971) { vm.skip(true); }
        uint256 amountIn = 1 ether;
        deal(WDOGE, address(router), amountIn);
        deal(WDOGE, address(this), amountIn);

        // Direct venue swap for reference output.
        IERC20(WDOGE).approve(V3, amountIn);
        uint256 directOut = IUniswapV3SwapRouter(V3).exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: WDOGE, tokenOut: USDC, fee: 500, recipient: address(this),
                amountIn: amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0
            })
        );

        // Router path (fee=0): expect within rounding of directOut.
        address recipient = makeAddr("recipient");
        bytes memory commands = abi.encodePacked(bytes1(0x03), bytes1(0x08));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(WDOGE, USDC, uint24(500), type(uint256).max, uint256(0));
        inputs[1] = abi.encode(USDC, recipient);
        router.execute(commands, inputs, block.timestamp + 1);

        uint256 routerOut = IERC20(USDC).balanceOf(recipient);
        // pool state shifts slightly between the two swaps; assert same order of magnitude.
        assertApproxEqRel(routerOut, directOut, 0.02e18); // within 2%
    }
}
```

- [ ] **Step 2: Run (with RPC)**

Run: `cd packages/contracts && forge test --match-contract RouterForkTest --fork-url https://rpc.testnet.dogeos.com -vvv`
Expected: PASS, or SKIPPED if the pool has no liquidity at the forked block (record which in the audit notes).

- [ ] **Step 3: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/test/fork/RouterFork.t.sol
git commit -m "test(contracts): live DogeOS fork differential vs direct venue swap"
```

### Task 5.2: Deploy script + version registry

**Files:**
- Create: `packages/contracts/src/RouterRegistry.sol`
- Create: `packages/contracts/script/DeployRouter.s.sol`
- Create: `packages/contracts/test/RouterRegistry.t.sol`

- [ ] **Step 1: Write the failing registry test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RouterRegistry} from "../src/RouterRegistry.sol";

contract RouterRegistryTest is Test {
    RouterRegistry reg;
    address owner = makeAddr("owner");
    function setUp() public { reg = new RouterRegistry(owner); }

    function test_setCurrentRouter_ownerOnly_andReadback() public {
        address r1 = makeAddr("r1");
        vm.prank(makeAddr("x")); vm.expectRevert();
        reg.setCurrentRouter(r1);
        vm.prank(owner); reg.setCurrentRouter(r1);
        assertEq(reg.currentRouter(), r1);
        assertEq(reg.version(), 1);
        address r2 = makeAddr("r2");
        vm.prank(owner); reg.setCurrentRouter(r2);
        assertEq(reg.version(), 2);
    }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd packages/contracts && forge test --match-contract RouterRegistryTest`
Expected: FAIL.

- [ ] **Step 3: Write `RouterRegistry.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "openzeppelin/access/Ownable2Step.sol";

/// @notice Off-chain readers query currentRouter() to find the active router version.
contract RouterRegistry is Ownable2Step {
    address public currentRouter;
    uint256 public version;
    event RouterUpdated(address indexed router, uint256 indexed version);
    constructor(address owner_) Ownable(owner_) {}
    function setCurrentRouter(address router) external onlyOwner {
        currentRouter = router;
        unchecked { version += 1; }
        emit RouterUpdated(router, version);
    }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd packages/contracts && forge test --match-contract RouterRegistryTest -vvv`
Expected: PASS.

- [ ] **Step 5: Write `DeployRouter.s.sol`** (reads deploy params from env; owner is the Timelock/Safe)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {RouterRegistry} from "../src/RouterRegistry.sol";

contract DeployRouter is Script {
    address constant WDOGE = 0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE;
    address constant V2 = 0xC653e745FC613a03D156DACB924AE8e9148B18dc;
    address constant V3 = 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB;
    address constant ALG = 0x77147f436cE9739D2A54Ffe428DBe02b90c0205e;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        address owner = vm.envAddress("ROUTER_OWNER");       // Timelock/Safe
        address guardian = vm.envAddress("ROUTER_GUARDIAN");

        // Safety: refuse to deploy if canonical Permit2 is absent (Task 0.2).
        require(PERMIT2.code.length > 0, "Permit2 not deployed on this chain");

        vm.startBroadcast();
        DogeOSAggregationRouter router =
            new DogeOSAggregationRouter(owner, guardian, WDOGE, V2, V3, ALG);
        RouterRegistry registry = new RouterRegistry(owner);
        registry.setCurrentRouter(address(router));
        vm.stopBroadcast();

        console2.log("router", address(router));
        console2.log("registry", address(registry));
    }
}
```

- [ ] **Step 6: Dry-run the script against the fork (no broadcast)**

Run:
```bash
cd packages/contracts
ROUTER_OWNER=0x000000000000000000000000000000000000dEaD \
ROUTER_GUARDIAN=0x000000000000000000000000000000000000bEEF \
forge script script/DeployRouter.s.sol --fork-url https://rpc.testnet.dogeos.com
```
Expected: simulation succeeds and logs addresses (requires canonical Permit2 present on DogeOS; if Task 0.2 found it absent, deploy Permit2 first via the Arachnid proxy, then re-run).

- [ ] **Step 7: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/src/RouterRegistry.sol packages/contracts/script/DeployRouter.s.sol packages/contracts/test/RouterRegistry.t.sol
git commit -m "feat(contracts): version registry + deploy script with Permit2 guard"
```

### Task 5.3: Live deploy + Blockscout verify + evidence swaps

**Files:**
- Create: `packages/contracts/audit/DEPLOYMENT.md`

> Requires a funded deployer key on DogeOS and owner/guardian addresses (the Safe + guardian). Treat as an operational step; record everything as evidence.

- [ ] **Step 1: Deploy + broadcast + verify**

```bash
cd packages/contracts
ROUTER_OWNER=<safe-or-timelock> ROUTER_GUARDIAN=<guardian> \
forge script script/DeployRouter.s.sol \
  --rpc-url https://rpc.testnet.dogeos.com \
  --broadcast --verify \
  --verifier blockscout \
  --verifier-url https://blockscout.testnet.dogeos.com/api \
  --private-key $DEPLOYER_PK
```
Expected: deploys router + registry, verifies source on Blockscout.

- [ ] **Step 2: Set the guarded-launch caps**

For each launch token (WDOGE/USDC/USDT/WETH/LBTC/USD1), call `setMaxInputPerTx(token, cap)` from the owner Safe with conservative caps. Record the chosen caps.

- [ ] **Step 3: Evidence swaps**

Execute one small swap through each path (V2, V3, Algebra, a split, a multi-hop) on the live router. Record every tx hash and Blockscout link in `audit/DEPLOYMENT.md`: router address, registry address, owner, guardian, caps, and the evidence-swap hashes.

- [ ] **Step 4: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/audit/DEPLOYMENT.md
git commit -m "docs(contracts): record DogeOS deployment + evidence swaps"
```

---

## Phase 6 — Audit-prep package

### Task 6.1: Threat model, invariant spec, NatSpec, reproducibility

**Files:**
- Create: `packages/contracts/audit/THREAT_MODEL.md`
- Create: `packages/contracts/audit/INVARIANTS.md`
- Create: `packages/contracts/audit/KNOWN_ISSUES.md`
- Modify: `packages/contracts/src/DogeOSAggregationRouter.sol` (NatSpec)
- Create: `packages/contracts/audit/REPRODUCIBILITY.md`

- [ ] **Step 1: Write `THREAT_MODEL.md`**

Transcribe the spec's threat-model table (reentrancy, allowance drain, arbitrary-call injection, fee/governance abuse, sandwich/MEV, fee-on-transfer, stuck native, reorgs, Permit2 replay, pause griefing, launch blast radius) and map each row to the exact mitigation in code (function + line) and the test that proves it.

- [ ] **Step 2: Write `INVARIANTS.md`**

List I1–I8 from the spec; for each, name the test (Foundry invariant `invariant_*`, Echidna/Medusa assertion) that exercises it, and note any that are argued rather than fuzzed (e.g. I5/I7 are structural — funds only move via SWEEP/fee/venue, venues are immutable — cite the code).

- [ ] **Step 3: Write `KNOWN_ISSUES.md`**

Document accepted trade-offs: per-token notional cap doesn't bound exotic unset tokens (backstop = minOut + balance-delta); standing max allowance from router to trusted immutable venues; interim cross-chain depends on the Dogecoin-L1 bridge (Sub-project D); fee on output measured post-swap.

- [ ] **Step 4: Add full NatSpec** to every external/public function and the contract header in `DogeOSAggregationRouter.sol` (and `RouterRegistry.sol`). Then run `forge build` to confirm it still compiles.

Run: `cd packages/contracts && forge build`
Expected: PASS.

- [ ] **Step 5: Write `REPRODUCIBILITY.md`** — pin exact dependency commits

```bash
cd packages/contracts
for d in lib/forge-std lib/permit2 lib/openzeppelin-contracts; do
  echo "$d $(git -C $d rev-parse HEAD)";
done
forge --version
```
Record solc (0.8.26), `evm_version` (from Task 0.1), optimizer runs (1,000,000), the dep commit hashes, and the SLOC (`cloc src/` or `find src -name '*.sol' | xargs wc -l`).

- [ ] **Step 6: Run the full suite one last time**

Run: `cd packages/contracts && forge test -vvv && forge build --sizes`
Expected: ALL PASS; contract under the 24,576-byte limit (check `--sizes`).

- [ ] **Step 7: Commit**

```bash
cd /Users/quietguy/Documents/Dev/dogeos
git add packages/contracts/audit packages/contracts/src
git commit -m "docs(contracts): audit-prep package (threat model, invariants, reproducibility, NatSpec)"
```

---

## Self-Review

**Spec coverage:**
- Command/executor architecture → Tasks 1.1–2.3 (Commands lib + dispatch + handlers). ✓
- Permit2 AllowanceTransfer (router = spender, witness N/A in AllowanceTransfer) → Task 1.3. ✓
- Off-by-default capped fee + governance setters → Tasks 1.4, 1.2. ✓
- Safe+timelock owner (Ownable2Step, owner = Timelock) + guardian pause → Task 1.2. ✓
- Staged notional cap → Task 1.3 (`maxInputPerTx`), set live in 5.3. ✓
- Immutable + versioned redeploy (RouterRegistry, no proxy) → Task 5.2. ✓
- Arbitrary tokens via SafeERC20 + balance-delta → MockERC20 FoT test 3.4, `safeTransfer`/`forceApprove`, `_resolveAmount` balance reads. ✓
- Venue immutability + callback model (call venue SwapRouters) → Tasks 2.1–2.3 (immutables, no router param). ✓
- Wrap/unwrap native, `receive()` only from WDOGE → Task 1.4, 3.4. ✓
- MEV: on-chain minOut + deadline → Task 1.2 (deadline), 3.4 (minout). ✓
- Security program: Slither/Echidna/Medusa/invariants/CI → Phase 4. ✓
- Fork + differential → Task 5.1. ✓
- Deploy + verify + evidence → Task 5.3. ✓
- Task #0 de-risking gates (OP-Stack/EVM, Permit2, MyDoge EIP-712) → Tasks 0.1–0.3. ✓
- Audit-prep package → Task 6.1. ✓
- Cross-chain stays off-chain (no router command) → confirmed by absence of a SETTLE command. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has a command + expected result. ✓

**Type consistency:** Command bytes match the table everywhere (`0x00`–`0x09`); handler signatures (`_v2Swap(bytes,uint256)`, `_v3Swap(bytes)`, `_algebraSwap(bytes,uint256)`) match their dispatch calls; `CONTRACT_BALANCE = type(uint256).max` used consistently for "full balance"; immutable names (`MUCHFI_V2_ROUTER`, `MUCHFI_V3_ROUTER`, `BARKSWAP_ALGEBRA_ROUTER`, `WDOGE`) identical across contract, tests, and deploy script; error selectors (`DeadlineExpired`, `LengthMismatch`, `UnknownCommand`, `Unauthorized`, `FeeTooHigh`, `NotionalCapExceeded`, `MinOutNotMet`, `InvalidSpender`, `NativeTransferFailed`) defined in Task 1.2 and referenced consistently. ✓

**Known deliberate scoping:** Echidna/Medusa harnesses pre-seed funds (cannot sign Permit2); the Permit2 path is covered by Foundry invariant + unit tests. The V3 interface intentionally omits `deadline` (SwapRouter02), Algebra includes it — matching the verified on-chain selectors `0x04e45aaf` and `0x1679c792`.
