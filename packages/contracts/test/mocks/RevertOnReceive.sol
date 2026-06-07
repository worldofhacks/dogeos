// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract RevertOnReceive {
    receive() external payable { revert("no"); }
}
