// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal MuchFi V3 (Uniswap-V3-style) SwapRouter interface for exact-input single swaps.
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
