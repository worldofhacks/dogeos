// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable2Step, Ownable} from "openzeppelin/access/Ownable2Step.sol";
import {Pausable} from "openzeppelin/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "openzeppelin/utils/ReentrancyGuardTransient.sol"; // EIP-1153 transient guard — DogeOS is Prague (transient storage confirmed by on-chain probe)
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Commands} from "./libraries/Commands.sol";
import {Constants} from "./libraries/Constants.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";
import {IUniswapV3SwapRouter} from "./interfaces/IUniswapV3SwapRouter.sol";
import {IAlgebraSwapRouter} from "./interfaces/IAlgebraSwapRouter.sol";

/// @title DogeSwapRouter
/// @author DogeOS
/// @notice Immutable, command/executor aggregation router for DogeOS. Executes atomic single,
///         split, and multi-hop swaps across the whitelisted DogeOS venues (MuchFi V2, MuchFi V3,
///         Barkswap Algebra) in one all-or-nothing transaction. Funds are pulled via Permit2
///         AllowanceTransfer (the user approves Permit2, never this router), `minOut` and
///         `deadline` are enforced on-chain, and an off-by-default capped protocol fee is taken in
///         settlement.
/// @dev Security model: movement-only command set (no arbitrary calls/delegatecall), immutable
///      venues, `nonReentrant` (EIP-1153 transient guard), and a per-execute in-memory `Ledger`
///      that measures every amount by balance delta (`current - entry`). This makes the router
///      unable to spend pre-existing/airdropped/stranded funds via `execute`, structurally
///      enforcing invariants I1 and I5. Final settlement (fee → minOut → payout → refunds) runs
///      after the command loop, making "recipient receives >= minOut or the whole tx reverts" a
///      contract guarantee (I2). Non-upgradeable: upgrades are a fresh deployment. Governance
///      (`owner`) is intended to be an OpenZeppelin `TimelockController`; the `guardian` is
///      pause-only. See `docs/superpowers/specs/2026-06-06-dogeos-aggregation-router-spec.md`.
contract DogeSwapRouter is Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Final settlement enforced after the command loop, independent of the command program.
    /// @dev Using the per-execute ledger delta of `buyToken`, the contract takes the capped fee,
    ///      pays the recipient, requires the recipient's measured receipt >= `minOut` (else revert),
    ///      and refunds leftover input-token deltas to `msg.sender`. Settlement is mandatory:
    ///      `execute` rejects `recipient == address(0)` and `recipient == address(this)`.
    /// @param buyToken The output token to deliver; use `NATIVE` (0xEeee…EEeE) to settle native DOGE.
    /// @param minOut Minimum net amount of `buyToken` (after fee) the recipient must actually receive.
    /// @param recipient Destination of the bought token; must be nonzero and not the router itself.
    struct Settlement { address buyToken; uint256 minOut; address recipient; }
    /// @notice In-memory per-execute ledger of every token the call touches.
    /// @dev No mappings → memory-safe; linear scan, command lists are short. `entry` is each token's
    ///      balance at first reference (native seeded as balance - msg.value); `pulled` is the
    ///      running input total used for the notional cap. All accounting uses `current - entry`.
    /// @param tokens Distinct tokens referenced this call (index 0 is always NATIVE).
    /// @param entry Each token's balance snapshot at first reference (excludes incoming msg.value for native).
    /// @param pulled Running per-token input total accrued for the aggregate notional cap (I8).
    /// @param count Number of populated entries.
    struct Ledger { address[] tokens; uint256[] entry; uint256[] pulled; uint256 count; }

    /// @notice Canonical Uniswap Permit2 (same address on every chain).
    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(Constants.PERMIT2);
    /// @notice Sentinel address denoting native DOGE in settlement and the ledger.
    address public constant NATIVE = Constants.NATIVE;
    /// @notice Immutable WDOGE (wrapped native) contract; the only authorized `receive()` sender.
    address public immutable WDOGE;
    /// @notice Immutable MuchFi V2 router (whitelisted venue).
    address public immutable MUCHFI_V2_ROUTER;
    /// @notice Immutable MuchFi V3 router (whitelisted venue).
    address public immutable MUCHFI_V3_ROUTER;
    /// @notice Immutable Barkswap Algebra router (whitelisted venue).
    address public immutable BARKSWAP_ALGEBRA_ROUTER;

    /// @notice Pause-only guardian key (may be address(0)).
    address public guardian;
    /// @notice Protocol fee in basis points (<= MAX_FEE_BPS); 0 disables the fee.
    uint256 public feeBps;
    /// @notice Recipient of the protocol fee (only paid when `feeBps != 0`).
    address public feeRecipient;
    /// @notice Default per-execute aggregate input cap for tokens without a specific cap (0 = no default cap).
    uint256 public defaultMaxInputPerTx;              // 0 = no default cap
    /// @notice Per-token per-execute aggregate input cap (0 = use default; type(uint256).max = explicitly uncapped).
    mapping(address => uint256) public maxInputPerTx; // 0 = use default; type(uint256).max = explicitly uncapped

    error DeadlineExpired(); error LengthMismatch(); error UnknownCommand(); error Unauthorized();
    error FeeTooHigh(); error NotionalCapExceeded(); error MinOutNotMet(); error InvalidSpender();
    error NativeTransferFailed(); error InsufficientLedgerBalance(); error LedgerOverflow();
    error ZeroAddress(); error InvalidRecipient(); error InvalidFeeRecipient();

    event GuardianUpdated(address indexed guardian);
    event FeeUpdated(uint256 feeBps, address indexed feeRecipient);
    event DefaultMaxInputUpdated(uint256 maxAmount);
    event MaxInputUpdated(address indexed token, uint256 maxAmount);
    event Swapped(address indexed sender, address indexed recipient);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    /// @notice Deploys the router, fixing the owner, guardian, and the immutable venue/WDOGE set.
    /// @dev Venue and WDOGE addresses are immutable for the contract's lifetime. `owner_` should be
    ///      an OpenZeppelin `TimelockController` in production; `guardian_` may be `address(0)` to
    ///      disable guardian-triggered pause (owner can still pause/unpause).
    /// @param owner_ Initial owner (intended TimelockController) — controls fee/cap/guardian/unpause/rescue.
    /// @param guardian_ Pause-only key for fast incident response (may be address(0)).
    /// @param wdoge_ Immutable WDOGE (wrapped native) contract used for wrap/unwrap and as the only `receive()` sender.
    /// @param v2_ Immutable MuchFi V2 router.
    /// @param v3_ Immutable MuchFi V3 router.
    /// @param alg_ Immutable Barkswap Algebra router.
    constructor(address owner_, address guardian_, address wdoge_, address v2_, address v3_, address alg_)
        Ownable(owner_)
    {
        // Zero venue/WDOGE addresses would make the router silently un-swappable; reject at deploy.
        // (guardian == address(0) stays valid: it disables guardian-triggered pause.)
        if (wdoge_ == address(0) || v2_ == address(0) || v3_ == address(0) || alg_ == address(0)) revert ZeroAddress();
        guardian = guardian_; WDOGE = wdoge_; MUCHFI_V2_ROUTER = v2_; MUCHFI_V3_ROUTER = v3_; BARKSWAP_ALGEBRA_ROUTER = alg_;
    }

    /// @notice Accepts native DOGE only from WDOGE (unwrap proceeds); reverts for any other sender.
    /// @dev Guards against arbitrary native inflows that the per-execute ledger would not have snapshotted.
    receive() external payable { if (msg.sender != WDOGE) revert Unauthorized(); }

    // ---- admin (owner == TimelockController) ----
    /// @notice Sets the guardian (pause-only) key. Owner-only.
    /// @dev `address(0)` is a valid state that disables guardian-triggered pause.
    /// @param g New guardian address.
    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianUpdated(g); }
    /// @notice Sets the protocol fee (basis points) and its recipient. Owner-only.
    /// @dev Reverts `FeeTooHigh` if `bps > MAX_FEE_BPS` (1%). Fee is a no-op in settlement when 0.
    /// @param bps Fee in basis points (<= MAX_FEE_BPS).
    /// @param r Fee recipient (only paid when `bps != 0`).
    function setFee(uint256 bps, address r) external onlyOwner {
        if (bps > Constants.MAX_FEE_BPS) revert FeeTooHigh();
        // A nonzero fee with a zero recipient is not "harmless": settlement would then
        // safeTransfer the fee to address(0) (reverts -> DoSes every ERC20-output swap) or
        // send native to address(0) (silently burns it). Couple the two: zero recipient is
        // only valid when the fee is off.
        if (bps != 0 && r == address(0)) revert InvalidFeeRecipient();
        feeBps = bps; feeRecipient = r; emit FeeUpdated(bps, r);
    }
    /// @notice Sets the default per-execute aggregate input cap for tokens without a specific cap. Owner-only.
    /// @dev `0` means no default cap (such tokens are uncapped unless they have a per-token cap).
    /// @param a New default aggregate-input cap per execute.
    function setDefaultMaxInputPerTx(uint256 a) external onlyOwner { defaultMaxInputPerTx = a; emit DefaultMaxInputUpdated(a); }
    /// @notice Sets a per-token per-execute aggregate input cap. Owner-only.
    /// @dev `0` => fall back to the default cap; `type(uint256).max` => explicitly uncapped.
    /// @param t Token to cap.
    /// @param a Aggregate-input cap per execute for `t`.
    function setMaxInputPerTx(address t, uint256 a) external onlyOwner { maxInputPerTx[t] = a; emit MaxInputUpdated(t, a); }
    /// @notice Pauses `execute`. Callable by the guardian or the owner (fast incident response).
    /// @dev Non-destructive; only the owner can `unpause`.
    function pause() external { if (msg.sender != guardian && msg.sender != owner()) revert Unauthorized(); _pause(); }
    /// @notice Unpauses `execute`. Owner-only (guardian cannot unpause).
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Recover funds NEVER brought in via execute (airdrops/stranded). Not reachable from execute().
    /// @dev Owner-only (Timelock) escape hatch for genuinely stuck pre-existing balances, which the
    ///      per-execute ledger makes unspendable through `execute`. Use `NATIVE` to rescue native DOGE.
    /// @param token Token to recover (or `NATIVE` for native DOGE).
    /// @param to Destination for the recovered funds.
    /// @param amount Amount to recover.
    // slither-disable-next-line reentrancy-events
    function rescue(address token, address to, uint256 amount) external onlyOwner { // onlyOwner (Timelock); event-after-call is benign for an admin-only escape hatch
        _pay(token, to, amount); emit Rescued(token, to, amount);
    }

    // ---- core ----
    /// @notice Executes an atomic command program (pulls, swaps, wraps) then enforces final settlement.
    /// @dev One byte per command in `commands`; `inputs[i]` is the ABI-encoded args for command `i`.
    ///      Reverts if paused, past `deadline`, or on length mismatch. Builds a per-execute in-memory
    ///      `Ledger` (native entry excludes `msg.value`; buyToken entry snapshotted up front), runs each
    ///      command via `_dispatch`, then `_settle`: takes the capped fee, requires the measured buyToken
    ///      delta >= `s.minOut`, pays the recipient, and refunds leftover input deltas to `msg.sender`.
    ///      All amounts are balance deltas, so pre-existing/stranded funds are unspendable here.
    ///      `payable` to support native DOGE in (wrap) flows. Guarded by `nonReentrant` (EIP-1153).
    /// @param commands Ordered command ids (one byte each); see `Commands`.
    /// @param inputs ABI-encoded arguments for each command (same length as `commands`).
    /// @param s Final settlement (buyToken, minOut, recipient); `recipient` must be nonzero and not the router.
    /// @param deadline Unix timestamp after which the call reverts `DeadlineExpired`.
    function execute(bytes calldata commands, bytes[] calldata inputs, Settlement calldata s, uint256 deadline)
        external payable whenNotPaused nonReentrant
    {
        // slither-disable-next-line timestamp
        if (block.timestamp > deadline) revert DeadlineExpired(); // deadline check; coarse miner drift is acceptable for swap expiry
        // Reject a zero/self recipient up front: both strand the per-execute proceeds (zero skips
        // settlement entirely; self leaves the bought token sitting in the router). Settlement is
        // mandatory, so funds always either reach the recipient or are refunded to msg.sender.
        if (s.recipient == address(0) || s.recipient == address(this)) revert InvalidRecipient();
        uint256 n = commands.length;
        if (inputs.length != n) revert LengthMismatch();

        // slither-disable-next-line uninitialized-local
        Ledger memory L; // zero-initialized by the EVM; arrays assigned on the next line before any read
        // sized for the worst case: each command may introduce up to 2 new tokens (swap in + out),
        // plus the NATIVE seed and the buyToken snapshot. _idx also guards against overflow.
        uint256 cap = 2 * n + 2;
        L.tokens = new address[](cap); L.entry = new uint256[](cap); L.pulled = new uint256[](cap);
        // seed native entry EXCLUDING this call's incoming value
        L.tokens[0] = NATIVE; L.entry[0] = address(this).balance - msg.value; L.count = 1;
        _touch(L, s.buyToken); // snapshot buyToken entry (recipient is validated non-zero above)
        // Meter ALL incoming native against the cap here, at the single ingress point, so the bound
        // holds whether the native is later wrapped or settled/refunded as native (I8). _wrapNative
        // therefore does NOT re-accrue.
        if (msg.value != 0) _accrueInput(L, NATIVE, msg.value);

        for (uint256 i; i < n; ) { _dispatch(commands[i], inputs[i], deadline, L); unchecked { ++i; } } // per-command external calls are the core design; reentrancy is blocked by nonReentrant + the ledger

        _settle(s, L);
        emit Swapped(msg.sender, s.recipient);
    }

    // ---- ledger (in-memory) ----
    function _bal(address t) internal view returns (uint256) {
        return t == NATIVE ? address(this).balance : IERC20(t).balanceOf(address(this));
    }
    function _idx(Ledger memory L, address t) internal view returns (uint256) {
        for (uint256 i; i < L.count; ++i) if (L.tokens[i] == t) return i;
        uint256 j = L.count; if (j >= L.tokens.length) revert LedgerOverflow();
        L.tokens[j] = t; L.entry[j] = _bal(t); L.count = j + 1; return j;
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
        else if (c == Commands.UNWRAP_NATIVE) _unwrapNative(input, L);
        else revert UnknownCommand();
    }

    function _permit2Permit(bytes calldata input) internal {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            abi.decode(input, (IAllowanceTransfer.PermitSingle, bytes));
        if (p.spender != address(this)) revert InvalidSpender();
        // Tolerate a permit that no longer applies — chiefly a front-runner who
        // replayed this signed permit from public calldata, advancing the user's
        // ordered Permit2 nonce so `permit` reverts InvalidNonce. The front-run
        // already SET the allowance the user signed (spender == this router), so
        // swallowing the revert lets the bundled swap proceed instead of bricking
        // it. If the permit failed for any other reason (bad sig / expired) the
        // allowance is not in place and the subsequent PERMIT2_TRANSFER_FROM
        // reverts on insufficient allowance, so the swap still fails closed.
        // Mirrors UniversalRouter's allow-revert permit handling.
        // slither-disable-next-line calls-loop
        try PERMIT2.permit(msg.sender, p, sig) {} catch {} // canonical Permit2; per-command call is intended, guarded by nonReentrant
    }
    function _permit2TransferFrom(bytes calldata input, Ledger memory L) internal {
        (address token, uint160 amount) = abi.decode(input, (address, uint160));
        _accrueInput(L, token, amount);
        // slither-disable-next-line calls-loop
        PERMIT2.transferFrom(msg.sender, address(this), amount, token); // canonical Permit2; per-command call is intended, guarded by nonReentrant
    }
    /// @dev Resolve a command's input amount to what THIS execute actually brought in.
    ///      CONTRACT_BALANCE => the per-execute delta; an explicit amount must be <= delta.
    ///      This makes pre-existing/airdropped balances unspendable via execute (I1/I5).
    function _spend(Ledger memory L, uint256 amount, address token) internal view returns (uint256) {
        uint256 d = _delta(L, token);
        uint256 amt = amount == Constants.CONTRACT_BALANCE ? d : amount;
        if (amt > d) revert InsufficientLedgerBalance();
        return amt;
    }
    /// @dev Exact, ephemeral venue approval: grant only `a` for the imminent swap. Paired with
    ///      `_clearVenue` so no standing allowance survives the call — a compromised/upgraded venue
    ///      then cannot reach the router's airdropped/stranded/rescue-pending balances out-of-band
    ///      (the per-execute ledger only bounds spends THROUGH execute, never a standing allowance).
    function _approveVenueExact(address t, address venue, uint256 a) internal {
        // slither-disable-next-line calls-loop
        IERC20(t).forceApprove(venue, a); // forceApprove handles USDT-style zero-before-nonzero
    }
    function _clearVenue(address t, address venue) internal {
        // slither-disable-next-line calls-loop
        IERC20(t).forceApprove(venue, 0); // reset to 0 so the allowance surface is provably zero between calls
    }
    function _v2Swap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (uint256 amountIn, uint256 minOut, address[] memory path) = abi.decode(input, (uint256, uint256, address[]));
        amountIn = _spend(L, amountIn, path[0]); _touch(L, path[path.length - 1]);
        _approveVenueExact(path[0], MUCHFI_V2_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IUniswapV2Router(MUCHFI_V2_ROUTER).swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline); // output measured by ledger _delta, not the venue's return value
        _clearVenue(path[0], MUCHFI_V2_ROUTER);
    }
    function _v3Swap(bytes calldata input, Ledger memory L) internal {
        (address tin, address tout, uint24 fee, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, uint24, uint256, uint256));
        amountIn = _spend(L, amountIn, tin); _touch(L, tout);
        _approveVenueExact(tin, MUCHFI_V3_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IUniswapV3SwapRouter(MUCHFI_V3_ROUTER).exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams({ // output measured by ledger _delta, not the venue's return value
            tokenIn: tin, tokenOut: tout, fee: fee, recipient: address(this),
            amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }));
        _clearVenue(tin, MUCHFI_V3_ROUTER);
    }
    function _algebraSwap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (address tin, address tout, address dep, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, address, uint256, uint256));
        amountIn = _spend(L, amountIn, tin); _touch(L, tout);
        _approveVenueExact(tin, BARKSWAP_ALGEBRA_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IAlgebraSwapRouter(BARKSWAP_ALGEBRA_ROUTER).exactInputSingle(IAlgebraSwapRouter.ExactInputSingleParams({ // output measured by ledger _delta, not the venue's return value
            tokenIn: tin, tokenOut: tout, deployer: dep, recipient: address(this),
            deadline: deadline, amountIn: amountIn, amountOutMinimum: minOut, limitSqrtPrice: 0 }));
        _clearVenue(tin, BARKSWAP_ALGEBRA_ROUTER);
    }
    function _wrapNative(bytes calldata input, Ledger memory L) internal {
        // Native ingress is metered once at execute() entry (msg.value), so wrapping — an internal
        // native->WDOGE conversion — is NOT re-accrued here.
        uint256 a = _spend(L, abi.decode(input, (uint256)), NATIVE);
        _touch(L, WDOGE);
        // slither-disable-next-line calls-loop
        IWETH9(WDOGE).deposit{value: a}(); // immutable WDOGE; per-command wrap is intended
    }
    function _unwrapNative(bytes calldata input, Ledger memory L) internal {
        uint256 a = _spend(L, abi.decode(input, (uint256)), WDOGE);
        // slither-disable-next-line calls-loop
        IWETH9(WDOGE).withdraw(a); // immutable WDOGE; per-command unwrap is intended
    }

    // ---- enforced settlement (I2/I4/I5 by construction) ----
    function _settle(Settlement calldata s, Ledger memory L) internal {
        // recipient is validated non-zero (and not self) in execute, so settlement always runs.
        uint256 out = _delta(L, s.buyToken);
        // slither-disable-next-line uninitialized-local
        uint256 fee; // intentional zero default; only assigned when a fee applies
        if (feeBps != 0 && out != 0) { fee = (out * feeBps) / Constants.BPS_DENOMINATOR; out -= fee; }
        if (fee != 0) _pay(s.buyToken, feeRecipient, fee);
        // Enforce minOut on what the recipient ACTUALLY receives, not the router's measured delta:
        // fee-on-transfer / deflationary output tokens credit the recipient less than `out`, so a
        // router-side check would not bind I2 for them. Reverting here rolls back the payouts above.
        uint256 received = _payReceived(s.buyToken, s.recipient, out);
        if (received < s.minOut) revert MinOutNotMet();
        for (uint256 i; i < L.count; ++i) {           // refund leftover deltas to caller
            address t = L.tokens[i];
            if (t == s.buyToken) continue;
            uint256 d = _delta(L, t);
            if (d == 0) continue;
            // A net-positive delta on a token that was NEVER pulled as input this
            // call (L.pulled[i] == 0) is swap OUTPUT the caller did not declare as
            // `buyToken`. Tax it like the buyToken so the protocol fee can't be
            // evaded by mislabeling the settlement token (e.g. declaring a zero-
            // delta input token as buyToken and collecting the real output here
            // fee-free). True unspent INPUT dust (pulled > 0) is the caller's own
            // funds and is refunded untaxed. feeRecipient is nonzero whenever
            // feeBps != 0 (setFee couples them), so the fee payment is safe.
            if (feeBps != 0 && L.pulled[i] == 0) {
                uint256 outputFee = (d * feeBps) / Constants.BPS_DENOMINATOR;
                if (outputFee != 0) { _pay(t, feeRecipient, outputFee); d -= outputFee; }
            }
            _pay(t, msg.sender, d);
        }
    }
    /// @dev Pay `amount` of `t` to `to` and return the amount `to` ACTUALLY received (its measured
    ///      balance delta), so settlement can bind minOut on the net receipt for fee-on-transfer
    ///      output tokens. For standard tokens the return equals `amount`.
    function _payReceived(address t, address to, uint256 amount) internal returns (uint256) {
        if (amount == 0) return 0;
        if (t == NATIVE) {
            uint256 bal = to.balance;
            _pay(t, to, amount);
            return to.balance - bal;
        }
        uint256 bal = IERC20(t).balanceOf(to);
        _pay(t, to, amount);
        return IERC20(t).balanceOf(to) - bal;
    }
    function _pay(address t, address to, uint256 amount) internal {
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return; // exact zero-amount short-circuit is intentional and safe
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        if (t == NATIVE) { (bool ok,) = to.call{value: amount}(""); if (!ok) revert NativeTransferFailed(); } // dest is caller-declared recipient/feeRecipient/msg.sender; amount bounded by per-execute _delta (stranded native unspendable)
        else IERC20(t).safeTransfer(to, amount);
    }
}
