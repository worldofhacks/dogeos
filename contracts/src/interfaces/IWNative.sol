// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal interface for the DogeOS wrapped native DOGE token.
interface IWNative is IERC20 {
    /// @notice Wrap native DOGE into WDOGE.
    function deposit() external payable;

    /// @notice Unwrap WDOGE into native DOGE.
    /// @param amount Amount of WDOGE to unwrap.
    function withdraw(uint256 amount) external;
}
