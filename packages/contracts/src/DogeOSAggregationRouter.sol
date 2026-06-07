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

contract DogeOSAggregationRouter is Ownable2Step, Pausable, ReentrancyGuardTransient {
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
    error NativeTransferFailed(); error InsufficientLedgerBalance();

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
    // slither-disable-next-line reentrancy-events
    function rescue(address token, address to, uint256 amount) external onlyOwner { // onlyOwner (Timelock); event-after-call is benign for an admin-only escape hatch
        _pay(token, to, amount); emit Rescued(token, to, amount);
    }

    // ---- core ----
    function execute(bytes calldata commands, bytes[] calldata inputs, Settlement calldata s, uint256 deadline)
        external payable whenNotPaused nonReentrant
    {
        // slither-disable-next-line timestamp
        if (block.timestamp > deadline) revert DeadlineExpired(); // deadline check; coarse miner drift is acceptable for swap expiry
        uint256 n = commands.length;
        if (inputs.length != n) revert LengthMismatch();

        // slither-disable-next-line uninitialized-local
        Ledger memory L; // zero-initialized by the EVM; arrays assigned on the next line before any read
        L.tokens = new address[](n + 2); L.entry = new uint256[](n + 2); L.pulled = new uint256[](n + 2);
        // seed native entry EXCLUDING this call's incoming value
        L.tokens[0] = NATIVE; L.entry[0] = address(this).balance - msg.value; L.count = 1;
        if (s.recipient != address(0)) _touch(L, s.buyToken); // snapshot buyToken entry

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
        else if (c == Commands.UNWRAP_NATIVE) _unwrapNative(input, L);
        else revert UnknownCommand();
    }

    function _permit2Permit(bytes calldata input) internal {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            abi.decode(input, (IAllowanceTransfer.PermitSingle, bytes));
        if (p.spender != address(this)) revert InvalidSpender();
        // slither-disable-next-line calls-loop
        PERMIT2.permit(msg.sender, p, sig); // canonical Permit2; per-command call is intended, guarded by nonReentrant
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
    function _approveVenue(address t, address venue, uint256 a) internal {
        // slither-disable-next-line calls-loop
        if (IERC20(t).allowance(address(this), venue) < a) IERC20(t).forceApprove(venue, type(uint256).max); // per-command venue approval is intended
    }
    function _v2Swap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (uint256 amountIn, uint256 minOut, address[] memory path) = abi.decode(input, (uint256, uint256, address[]));
        amountIn = _spend(L, amountIn, path[0]); _touch(L, path[path.length - 1]);
        _approveVenue(path[0], MUCHFI_V2_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IUniswapV2Router(MUCHFI_V2_ROUTER).swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline); // output measured by ledger _delta, not the venue's return value
    }
    function _v3Swap(bytes calldata input, Ledger memory L) internal {
        (address tin, address tout, uint24 fee, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, uint24, uint256, uint256));
        amountIn = _spend(L, amountIn, tin); _touch(L, tout);
        _approveVenue(tin, MUCHFI_V3_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IUniswapV3SwapRouter(MUCHFI_V3_ROUTER).exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams({ // output measured by ledger _delta, not the venue's return value
            tokenIn: tin, tokenOut: tout, fee: fee, recipient: address(this),
            amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }));
    }
    function _algebraSwap(bytes calldata input, uint256 deadline, Ledger memory L) internal {
        (address tin, address tout, address dep, uint256 amountIn, uint256 minOut) =
            abi.decode(input, (address, address, address, uint256, uint256));
        amountIn = _spend(L, amountIn, tin); _touch(L, tout);
        _approveVenue(tin, BARKSWAP_ALGEBRA_ROUTER, amountIn);
        // slither-disable-next-line unused-return,calls-loop
        IAlgebraSwapRouter(BARKSWAP_ALGEBRA_ROUTER).exactInputSingle(IAlgebraSwapRouter.ExactInputSingleParams({ // output measured by ledger _delta, not the venue's return value
            tokenIn: tin, tokenOut: tout, deployer: dep, recipient: address(this),
            deadline: deadline, amountIn: amountIn, amountOutMinimum: minOut, limitSqrtPrice: 0 }));
    }
    function _wrapNative(bytes calldata input, Ledger memory L) internal {
        uint256 a = _spend(L, abi.decode(input, (uint256)), NATIVE);
        _accrueInput(L, NATIVE, a); _touch(L, WDOGE);
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
        if (s.recipient == address(0)) return; // no-op (unit tests only)
        uint256 out = _delta(L, s.buyToken);
        // slither-disable-next-line uninitialized-local
        uint256 fee; // intentional zero default; only assigned when a fee applies
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
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return; // exact zero-amount short-circuit is intentional and safe
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        if (t == NATIVE) { (bool ok,) = to.call{value: amount}(""); if (!ok) revert NativeTransferFailed(); } // dest is caller-declared recipient/feeRecipient/msg.sender; amount bounded by per-execute _delta (stranded native unspendable)
        else IERC20(t).safeTransfer(to, amount);
    }
}
