// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract MockRejectNativeRecipient {
    receive() external payable {
        revert("NATIVE_REJECTED");
    }
}
