// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal Uniswap V2-style pair interface used by DogeOS V2 adapters.
interface IUniswapV2Pair {
    /// @notice First token in the pair.
    /// @return token0 Token0 address.
    function token0() external view returns (address token0);

    /// @notice Second token in the pair.
    /// @return token1 Token1 address.
    function token1() external view returns (address token1);

    /// @notice Current reserves and last update timestamp.
    /// @return reserve0 Token0 reserve.
    /// @return reserve1 Token1 reserve.
    /// @return blockTimestampLast Last reserve update timestamp.
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    /// @notice Execute a V2-style swap.
    /// @param amount0Out Token0 output.
    /// @param amount1Out Token1 output.
    /// @param to Recipient.
    /// @param data Callback data, empty for this adapter.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}
