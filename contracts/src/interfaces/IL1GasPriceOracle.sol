// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice DogeOS Data and Finality fee oracle predeploy interface.
interface IL1GasPriceOracle {
    /// @notice Estimate the DogeOS data/finality fee for transaction calldata.
    /// @param data Transaction calldata bytes.
    /// @return fee Estimated fee denominated in native DOGE wei.
    function getL1Fee(bytes calldata data) external view returns (uint256 fee);
}
