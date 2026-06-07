// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";
import {TimelockController} from "openzeppelin/governance/TimelockController.sol";
import {Ownable} from "openzeppelin/access/Ownable.sol";
import {Ownable2Step} from "openzeppelin/access/Ownable2Step.sol";

/// @notice End-to-end governance test: the router owner is a real TimelockController whose
///         proposer/executor is the project Safe. Verifies the timelock delay is enforced on
///         router admin actions, the guardian is pause-only, and Ownable2Step handover is two-step.
contract RouterGovernanceTest is Test {
    uint256 internal constant MIN_DELAY = 2 days;

    DogeSwapRouter internal router;
    TimelockController internal timelock;

    address internal safe = makeAddr("safe");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");
    address internal feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        address[] memory proposers = new address[](1);
        proposers[0] = safe;
        address[] memory executors = new address[](1);
        executors[0] = safe;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, safe);

        // deploy router owned by this test, capped + fee off
        router = new DogeSwapRouter(
            address(this), guardian, makeAddr("w"), makeAddr("v2"), makeAddr("v3"), makeAddr("alg")
        );

        // hand the router to the timelock (Ownable2Step), then have the timelock accept it
        router.transferOwnership(address(timelock));
        _timelockAcceptRouterOwnership();
        assertEq(router.owner(), address(timelock), "timelock owns router after acceptance");
    }

    // --- helpers ---------------------------------------------------------------------------------

    /// @dev Standard OZ flow: Safe schedules an op on the timelock, warp past the delay, Safe executes.
    function _timelockRun(bytes memory data) internal {
        bytes32 predecessor = bytes32(0);
        bytes32 salt = bytes32(0);

        vm.prank(safe);
        timelock.schedule(address(router), 0, data, predecessor, salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(safe);
        timelock.execute(address(router), 0, data, predecessor, salt);
    }

    function _timelockAcceptRouterOwnership() internal {
        _timelockRun(abi.encodeCall(Ownable2Step.acceptOwnership, ()));
    }

    // --- (a) timelock delay is enforced on router admin actions ----------------------------------

    function test_timelock_executeBeforeDelayReverts_thenSucceeds() public {
        bytes memory data = abi.encodeCall(DogeSwapRouter.setFee, (50, feeRecipient));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = bytes32(0);

        vm.prank(safe);
        timelock.schedule(address(router), 0, data, predecessor, salt, MIN_DELAY);

        // executing before the delay elapses must revert (operation not Ready)
        vm.warp(block.timestamp + MIN_DELAY - 1);
        vm.prank(safe);
        vm.expectRevert();
        timelock.execute(address(router), 0, data, predecessor, salt);
        assertEq(router.feeBps(), 0, "fee unchanged before delay");

        // after the delay it succeeds
        vm.warp(block.timestamp + 1);
        vm.prank(safe);
        timelock.execute(address(router), 0, data, predecessor, salt);
        assertEq(router.feeBps(), 50, "fee applied after delay");
        assertEq(router.feeRecipient(), feeRecipient, "fee recipient set after delay");
    }

    function test_timelock_setMaxInputPerTx_respectsDelay() public {
        address tok = makeAddr("tok");
        bytes memory data = abi.encodeCall(DogeSwapRouter.setMaxInputPerTx, (tok, 777e18));

        // schedule with too-short a delay must revert at schedule time
        vm.prank(safe);
        vm.expectRevert();
        timelock.schedule(address(router), 0, data, bytes32(0), bytes32(0), MIN_DELAY - 1);

        // proper flow applies the cap
        _timelockRun(data);
        assertEq(router.maxInputPerTx(tok), 777e18, "cap set via timelock");
    }

    function test_directOwnerCall_byStranger_reverts() public {
        // owner is the timelock now; nobody else can call onlyOwner directly
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        router.setFee(10, feeRecipient);

        // even the safe cannot call the router directly (must route through the timelock)
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, safe));
        router.setMaxInputPerTx(makeAddr("x"), 1);
    }

    // --- (b) guardian is pause-only --------------------------------------------------------------

    function test_guardian_canPause() public {
        vm.prank(guardian);
        router.pause();
        assertTrue(router.paused(), "guardian paused the router");
    }

    function test_guardian_cannotUnpause() public {
        vm.prank(guardian);
        router.pause();

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        router.unpause();
        assertTrue(router.paused(), "still paused; guardian cannot unpause");

        // only the owner (timelock) can unpause
        _timelockRun(abi.encodeCall(DogeSwapRouter.unpause, ()));
        assertFalse(router.paused(), "timelock unpaused");
    }

    function test_guardian_cannotSetFee() public {
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        router.setFee(10, feeRecipient);
    }

    function test_guardian_cannotSetMaxInputPerTx() public {
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        router.setMaxInputPerTx(makeAddr("x"), 1);
    }

    // --- (c) Ownable2Step: a stranger cannot acceptOwnership -------------------------------------

    function test_ownable2Step_strangerCannotAcceptOwnership() public {
        // fresh router with a pending handover to the timelock
        DogeSwapRouter r2 = new DogeSwapRouter(
            address(this), guardian, makeAddr("w"), makeAddr("v2"), makeAddr("v3"), makeAddr("alg")
        );
        r2.transferOwnership(address(timelock));
        assertEq(r2.pendingOwner(), address(timelock), "timelock is pending owner");

        // a stranger cannot finalize the handover
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r2.acceptOwnership();
        assertEq(r2.owner(), address(this), "ownership not transferred to stranger");

        // even the safe (directly) cannot accept — only the pending owner (the timelock) can
        vm.prank(safe);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, safe));
        r2.acceptOwnership();
    }
}
