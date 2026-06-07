// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Shared constants for DogeOSAggregationRouter: sentinels, fee cap, and canonical Permit2.
library Constants {
    /// @dev Sentinel meaning "use the router's full current balance of the token".
    uint256 internal constant CONTRACT_BALANCE = type(uint256).max;
    /// @dev Hard cap on the configurable protocol fee (1%).
    uint256 internal constant MAX_FEE_BPS = 100;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    /// @dev Canonical Uniswap Permit2 (same address on every chain).
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev Pseudo-address denoting native DOGE in settlement/ledger.
    address internal constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
}
