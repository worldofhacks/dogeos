// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeOSAggregationRouter} from "../../src/DogeOSAggregationRouter.sol";
import {Constants} from "../../src/libraries/Constants.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockV3Router} from "../mocks/MockV3Router.sol";
import {PermitSignature} from "../utils/PermitSignature.sol";

/// @notice Trail-of-Bits-style stateful handler for the DogeOS Aggregation Router.
/// @dev Drives a bounded `swap` action against the live router + Permit2 + a V3 venue mock,
///      accumulating ghost variables that the invariant test asserts over. The handler
///      deploys nothing; the test wires every dependency and passes it in.
contract RouterHandler is Test, PermitSignature {
    DogeOSAggregationRouter public immutable router;
    IAllowanceTransfer public immutable permit2;
    MockV3Router public immutable v3;
    MockERC20 public immutable tin;
    MockERC20 public immutable tout;

    address public immutable user;
    uint256 internal immutable userPk;
    address public immutable recipient;
    address public immutable feeRecipient;

    // ---- ghost variables ----
    uint256 public ghost_pulled;        // I3: total tin pulled across all settled executes
    uint256 public ghost_recipientOut;  // I4/I5: total tout delivered to recipient
    uint256 public ghost_feeOut;        // I4: total tout delivered to feeRecipient
    uint256 public ghost_lastMinOut;    // last declared net-out floor
    bool public ghost_minOutHonored = true; // I2: must stay true forever
    uint256 public ghost_swaps;         // number of settled executes (call accounting)

    // Permit2 nonces are consumed monotonically; track the next unused one.
    uint48 internal nonce;

    constructor(
        DogeOSAggregationRouter router_,
        IAllowanceTransfer permit2_,
        MockV3Router v3_,
        MockERC20 tin_,
        MockERC20 tout_,
        address user_,
        uint256 userPk_,
        address recipient_,
        address feeRecipient_
    ) {
        router = router_;
        permit2 = permit2_;
        v3 = v3_;
        tin = tin_;
        tout = tout_;
        user = user_;
        userPk = userPk_;
        recipient = recipient_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Single fuzz action: pull `amount` of tin via Permit2, swap the full pulled
    ///         balance through the V3 venue, and settle to `recipient` with a conservative
    ///         net-out floor. On success, fold the observed effects into the ghosts.
    function swap(uint256 amount) external {
        amount = bound(amount, 1e15, 50 ether);
        if (tin.balanceOf(user) < amount) return;

        // Conservative floor: well below the realized net rate (0.995 venue * 0.997 fee ≈ 0.992).
        uint256 minOut = (amount * 9_000) / 10_000;

        // Build the Permit2 single-permit for this pull.
        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tin),
                amount: uint160(amount),
                expiration: uint48(block.timestamp + 1 days),
                nonce: nonce
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);

        // commands: [PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM, V3_SWAP]
        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01), bytes1(0x03));
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(tin), uint160(amount));
        inputs[2] = abi.encode(
            address(tin), address(tout), uint24(500), Constants.CONTRACT_BALANCE, uint256(0)
        );

        DogeOSAggregationRouter.Settlement memory s = DogeOSAggregationRouter.Settlement({
            buyToken: address(tout),
            minOut: minOut,
            recipient: recipient
        });

        uint256 recipBefore = tout.balanceOf(recipient);
        uint256 feeBefore = tout.balanceOf(feeRecipient);

        vm.prank(user);
        try router.execute(commands, inputs, s, block.timestamp + 1) {
            nonce++;
            ghost_swaps++;
            ghost_lastMinOut = minOut;
            uint256 got = tout.balanceOf(recipient) - recipBefore;
            ghost_pulled += amount;
            ghost_recipientOut += got;
            ghost_feeOut += tout.balanceOf(feeRecipient) - feeBefore;
            if (got < minOut) ghost_minOutHonored = false; // I2: must never trip
        } catch {
            // Revert ⇒ no state change; acceptable under fuzzing (fail_on_revert = false).
        }
    }
}
