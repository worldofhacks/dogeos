// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal MuchFi V2 (Uniswap-V2-style) router interface for token-to-token swaps.
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
