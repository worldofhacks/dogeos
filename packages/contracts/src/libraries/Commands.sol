// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Fixed, movement-only command whitelist for DogeOSAggregationRouter.execute.
/// @dev No CALL/DELEGATECALL/arbitrary-target command exists, by design. Fee/min-out/payout
///      /refund are handled by enforced settlement, not by commands.
library Commands {
    bytes1 internal constant PERMIT2_PERMIT        = 0x00;
    bytes1 internal constant PERMIT2_TRANSFER_FROM = 0x01;
    bytes1 internal constant V2_SWAP               = 0x02;
    bytes1 internal constant V3_SWAP               = 0x03;
    bytes1 internal constant ALGEBRA_SWAP          = 0x04;
    bytes1 internal constant WRAP_NATIVE           = 0x05;
    bytes1 internal constant UNWRAP_NATIVE         = 0x06;
}
