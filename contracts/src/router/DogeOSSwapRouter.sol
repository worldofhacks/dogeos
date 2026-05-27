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
    error IdenticalTokens(address token);
    error OutputBelowMinimum(uint256 amountOut, uint256 minAmountOut);
    error NativeTransferFailed();
    error NativeValueMismatch(uint256 expected, uint256 actual);
    error UnexpectedNativeDogeSender(address sender);
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
    mapping(address adapter => bool allowed) public allowedAdapter;

    /// @notice Create the DogeOS swap router.
    /// @param initialOwner Initial owner, expected to become a multisig before mainnet.
    /// @param wDoge_ Wrapped DOGE token address.
    constructor(address initialOwner, IWNative wDoge_) Ownable(initialOwner) {
        if (address(wDoge_) == address(0)) revert ZeroAddress();
        wDoge = wDoge_;
    }

    /// @notice Accept only WDOGE unwrap transfers.
    receive() external payable {
        if (msg.sender != address(wDoge)) revert UnexpectedNativeDogeSender(msg.sender);
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
    /// @return amountOut Amount actually received by the router and forwarded to the recipient.
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

        address adapterTokenIn = params.tokenIn == NATIVE_DOGE ? address(wDoge) : params.tokenIn;
        address adapterTokenOut = params.tokenOut == NATIVE_DOGE ? address(wDoge) : params.tokenOut;
        if (adapterTokenIn == adapterTokenOut) revert IdenticalTokens(adapterTokenIn);

        IDogeOSSwapAdapter.ExactInputParams memory adapterParams = params;
        adapterParams.recipient = address(this);
        if (params.tokenIn == NATIVE_DOGE) {
            wDoge.deposit{value: params.amountIn}();
        } else {
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        }

        adapterParams.tokenIn = adapterTokenIn;
        adapterParams.tokenOut = adapterTokenOut;

        uint256 outputBefore = IERC20(adapterTokenOut).balanceOf(address(this));
        IERC20(adapterParams.tokenIn).forceApprove(adapter, params.amountIn);
        IDogeOSSwapAdapter(adapter).exactInput(adapterParams);
        IERC20(adapterParams.tokenIn).forceApprove(adapter, 0);
        amountOut = IERC20(adapterTokenOut).balanceOf(address(this)) - outputBefore;

        if (amountOut < params.minAmountOut) {
            revert OutputBelowMinimum(amountOut, params.minAmountOut);
        }

        if (params.tokenOut == NATIVE_DOGE) {
            wDoge.withdraw(amountOut);
            (bool sent, ) = params.recipient.call{value: amountOut}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            IERC20(adapterTokenOut).safeTransfer(params.recipient, amountOut);
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
