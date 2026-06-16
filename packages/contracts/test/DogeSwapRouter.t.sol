// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";

contract RouterCoreTest is Test {
    DogeSwapRouter router;
    address owner = makeAddr("owner");        // stands in for the Timelock
    address guardian = makeAddr("guardian");
    address wdoge = makeAddr("wdoge");
    address v2 = makeAddr("v2");
    address v3 = makeAddr("v3");
    address algebra = makeAddr("algebra");

    // These tests all revert BEFORE settlement (deadline/length/unknown/paused), so a nonzero
    // recipient just clears the recipient guard; buyToken == NATIVE avoids a balanceOf on a
    // non-contract during the buyToken snapshot.
    address internal constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function _noopSettlement() internal pure returns (DogeSwapRouter.Settlement memory) {
        return DogeSwapRouter.Settlement({buyToken: NATIVE, minOut: 0, recipient: address(0xBEEF)});
    }

    function setUp() public {
        router = new DogeSwapRouter(owner, guardian, wdoge, v2, v3, algebra);
    }

    function test_constructor_setsImmutablesAndRoles() public view {
        assertEq(router.owner(), owner);
        assertEq(router.guardian(), guardian);
        assertEq(router.WDOGE(), wdoge);
        assertEq(router.MUCHFI_V2_ROUTER(), v2);
        assertEq(router.MUCHFI_V3_ROUTER(), v3);
        assertEq(router.BARKSWAP_ALGEBRA_ROUTER(), algebra);
        assertEq(router.feeBps(), 0);
    }

    function test_execute_revertsOnExpiredDeadline() public {
        bytes memory commands = "";
        bytes[] memory inputs = new bytes[](0);
        vm.expectRevert(DogeSwapRouter.DeadlineExpired.selector);
        router.execute(commands, inputs, _noopSettlement(), block.timestamp == 0 ? 0 : block.timestamp - 1);
    }

    function test_execute_revertsOnLengthMismatch() public {
        bytes memory commands = hex"05"; // WRAP_NATIVE
        bytes[] memory inputs = new bytes[](0);
        vm.expectRevert(DogeSwapRouter.LengthMismatch.selector);
        router.execute(commands, inputs, _noopSettlement(), block.timestamp + 1);
    }

    function test_execute_revertsOnUnknownCommand() public {
        bytes memory commands = hex"ff";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = "";
        vm.expectRevert(DogeSwapRouter.UnknownCommand.selector);
        router.execute(commands, inputs, _noopSettlement(), block.timestamp + 1);
    }

    function test_pause_blocksExecute_andRolesEnforced() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(DogeSwapRouter.Unauthorized.selector);
        router.pause();

        vm.prank(guardian);
        router.pause();

        bytes memory commands = "";
        bytes[] memory inputs = new bytes[](0);
        vm.expectRevert(); // Pausable: EnforcedPause
        router.execute(commands, inputs, _noopSettlement(), block.timestamp + 1);

        vm.prank(guardian);
        vm.expectRevert(); // guardian cannot unpause (onlyOwner -> OwnableUnauthorizedAccount)
        router.unpause(); // guardian cannot unpause

        vm.prank(owner);
        router.unpause();
    }

    function test_setFee_revertsAboveCap_andOwnerOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        router.setFee(10, makeAddr("fee"));

        vm.prank(owner);
        vm.expectRevert(DogeSwapRouter.FeeTooHigh.selector);
        router.setFee(101, makeAddr("fee")); // > MAX_FEE_BPS (100)

        vm.prank(owner);
        router.setFee(100, makeAddr("fee"));
        assertEq(router.feeBps(), 100);
    }

    // A nonzero fee with a zero recipient is rejected (would DoS ERC20-output swaps / burn native).
    function test_setFee_revertsZeroRecipientWithFee() public {
        vm.prank(owner);
        vm.expectRevert(DogeSwapRouter.InvalidFeeRecipient.selector);
        router.setFee(50, address(0));

        // turning the fee OFF with a zero recipient stays valid.
        vm.prank(owner);
        router.setFee(0, address(0));
        assertEq(router.feeBps(), 0);
        assertEq(router.feeRecipient(), address(0));
    }

    function test_execute_revertsOnZeroRecipient() public {
        bytes memory commands = "";
        bytes[] memory inputs = new bytes[](0);
        DogeSwapRouter.Settlement memory s =
            DogeSwapRouter.Settlement({buyToken: NATIVE, minOut: 0, recipient: address(0)});
        vm.expectRevert(DogeSwapRouter.InvalidRecipient.selector);
        router.execute(commands, inputs, s, block.timestamp + 1);
    }

    function test_execute_revertsOnSelfRecipient() public {
        bytes memory commands = "";
        bytes[] memory inputs = new bytes[](0);
        DogeSwapRouter.Settlement memory s =
            DogeSwapRouter.Settlement({buyToken: NATIVE, minOut: 0, recipient: address(router)});
        vm.expectRevert(DogeSwapRouter.InvalidRecipient.selector);
        router.execute(commands, inputs, s, block.timestamp + 1);
    }

    function test_constructor_revertsOnZeroVenue() public {
        vm.expectRevert(DogeSwapRouter.ZeroAddress.selector);
        new DogeSwapRouter(owner, guardian, address(0), v2, v3, algebra);

        vm.expectRevert(DogeSwapRouter.ZeroAddress.selector);
        new DogeSwapRouter(owner, guardian, wdoge, v2, address(0), algebra);

        // guardian == address(0) stays valid (disables guardian-triggered pause).
        DogeSwapRouter ok = new DogeSwapRouter(owner, address(0), wdoge, v2, v3, algebra);
        assertEq(ok.guardian(), address(0));
    }
}
