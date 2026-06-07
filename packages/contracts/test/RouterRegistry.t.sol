// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {RouterRegistry} from "../src/RouterRegistry.sol";
import {Ownable} from "openzeppelin/access/Ownable.sol";

contract RouterRegistryTest is Test {
    RouterRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal routerA = makeAddr("routerA");
    address internal routerB = makeAddr("routerB");

    event RouterUpdated(address indexed router, uint256 version);

    function setUp() public {
        registry = new RouterRegistry(owner);
    }

    function test_constructor_setsOwnerAndZeroState() public view {
        assertEq(registry.owner(), owner, "owner set");
        assertEq(registry.currentRouter(), address(0), "router starts unset");
        assertEq(registry.version(), 0, "version starts at 0");
    }

    function test_setCurrentRouter_ownerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setCurrentRouter(routerA);

        // state untouched after the failed call
        assertEq(registry.currentRouter(), address(0), "router unchanged");
        assertEq(registry.version(), 0, "version unchanged");
    }

    function test_setCurrentRouter_updatesPointerAndEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit RouterUpdated(routerA, 1);
        vm.prank(owner);
        registry.setCurrentRouter(routerA);

        assertEq(registry.currentRouter(), routerA, "pointer updated");
        assertEq(registry.version(), 1, "version incremented to 1");
    }

    function test_setCurrentRouter_versionIncrementsOnEveryCall() public {
        vm.prank(owner);
        registry.setCurrentRouter(routerA);
        assertEq(registry.version(), 1, "version 1 after first set");

        vm.prank(owner);
        registry.setCurrentRouter(routerB);
        assertEq(registry.currentRouter(), routerB, "pointer moved to B");
        assertEq(registry.version(), 2, "version 2 after second set");

        // re-pointing to the same address still bumps the version
        vm.prank(owner);
        registry.setCurrentRouter(routerB);
        assertEq(registry.version(), 3, "version 3 even when address unchanged");
    }

    function test_ownership_isTwoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);
        // pending — old owner still in control until acceptance
        assertEq(registry.owner(), owner, "owner unchanged before acceptance");
        assertEq(registry.pendingOwner(), newOwner, "pending owner set");

        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner, "owner transferred after acceptance");
    }
}
