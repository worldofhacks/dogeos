// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Typed adapter interface for DogeOS router-controlled exact-input swaps.
interface IDogeOSSwapAdapter {
    /// @notice Parameters passed from the DogeOS router to an allowlisted adapter.
    /// @param tokenIn Input token; adapters receive wrapped DOGE when native DOGE is used.
    /// @param tokenOut Output token; adapters return wrapped DOGE when native DOGE is requested.
    /// @param recipient Recipient of adapter output. The router sets this to itself before forwarding to the final recipient.
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
