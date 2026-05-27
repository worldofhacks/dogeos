// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal Uniswap V2-style factory interface used by DogeOS V2 adapters.
interface IUniswapV2Factory {
    /// @notice Return the canonical pair for two tokens, or zero if none exists.
    /// @param tokenA First token.
    /// @param tokenB Second token.
    /// @return pair Pair address.
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
