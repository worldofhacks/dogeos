// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDogeOSSwapAdapter} from "../../src/interfaces/IDogeOSSwapAdapter.sol";
import {MockConstantProductPool} from "./MockConstantProductPool.sol";

/// @notice Test-only V2-style adapter that executes against a seeded constant-product pool.
contract MockV2SwapAdapter is IDogeOSSwapAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidRouteData();
    error OutputBelowMinimum(uint256 amountOut, uint256 minAmountOut);
    error PairMismatch(address tokenIn, address tokenOut, address pool);
    error UnexpectedNativeValue(uint256 value);
    error ZeroAddress();
    error ZeroAmount();

    /// @notice Quote a test pool exact-input route.
    /// @param pool Constant-product test pool.
    /// @param tokenIn Input token address.
    /// @param amountIn Exact input amount.
    /// @return amountOut Expected output from the pool.
    function quoteExactInput(
        MockConstantProductPool pool,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        return pool.getAmountOut(tokenIn, amountIn);
    }

    /// @notice Execute an exact-input route against the pool encoded in `params.routeData`.
    /// @param params Typed exact-input route parameters.
    /// @return amountOut Amount produced by the pool.
    function exactInput(ExactInputParams calldata params) external payable nonReentrant returns (uint256 amountOut) {
        if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
        if (params.recipient == address(0)) revert ZeroAddress();
        if (params.amountIn == 0) revert ZeroAmount();

        MockConstantProductPool pool = _decodePool(params.routeData);
        _validatePair(pool, params.tokenIn, params.tokenOut);

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(pool), params.amountIn);
        amountOut = pool.swapExactInput(params.tokenIn, params.amountIn, params.recipient);
        if (amountOut < params.minAmountOut) revert OutputBelowMinimum(amountOut, params.minAmountOut);
    }

    function _decodePool(bytes calldata routeData) private pure returns (MockConstantProductPool pool) {
        if (routeData.length != 32) revert InvalidRouteData();
        pool = MockConstantProductPool(abi.decode(routeData, (address)));
        if (address(pool) == address(0)) revert ZeroAddress();
    }

    function _validatePair(MockConstantProductPool pool, address tokenIn, address tokenOut) private view {
        address poolToken0 = pool.token0();
        address poolToken1 = pool.token1();
        bool forward = tokenIn == poolToken0 && tokenOut == poolToken1;
        bool reverse = tokenIn == poolToken1 && tokenOut == poolToken0;
        if (!forward && !reverse) revert PairMismatch(tokenIn, tokenOut, address(pool));
    }
}
