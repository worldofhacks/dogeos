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

    function _noopSettlement() internal pure returns (DogeSwapRouter.Settlement memory) {
        return DogeSwapRouter.Settlement({buyToken: address(0), minOut: 0, recipient: address(0)});
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
}
