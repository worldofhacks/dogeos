// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";
import {RouterHandler} from "./handlers/RouterHandler.sol";

/// @notice Invariant / property suite (I1–I8) for the DogeOS Aggregation Router.
/// @dev Trail-of-Bits property-based methodology: a stateful `RouterHandler` (handler pattern +
///      ghost variables + bounded inputs) is the sole fuzz target via `targetSelector`. I1–I5/I7
///      are checked as stateful fuzz invariants; I6 and I8 are deterministic and verified as
///      explicit unit tests in this same file.
contract RouterInvariantsTest is Test, DeployPermit2, PermitSignature {
    IAllowanceTransfer internal permit2;
    DogeSwapRouter internal router;
    MockV3Router internal v3;
    MockERC20 internal tin;
    MockERC20 internal tout;
    RouterHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal recipient = makeAddr("recipient");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal user;
    uint256 internal userPk;

    uint256 internal constant USER_INITIAL = 1_000_000 ether;
    uint256 internal constant FEE_BPS = 30; // 0.30%

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        v3 = new MockV3Router();
        // venue placeholders for v2/algebra/wdoge are unused by the handler's V3-only program.
        router = new DogeSwapRouter(
            owner, guardian, makeAddr("wdoge"), makeAddr("v2"), address(v3), makeAddr("alg")
        );

        vm.prank(owner);
        router.setFee(FEE_BPS, feeRecipient);

        tin = new MockERC20("IN", "IN");
        tout = new MockERC20("OUT", "OUT");

        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, USER_INITIAL);
        vm.prank(user);
        tin.approve(address(permit2), type(uint256).max);

        handler = new RouterHandler(
            router, permit2, v3, tin, tout, user, userPk, recipient, feeRecipient
        );

        // The handler is the only fuzz target, exercising only the `swap` action.
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = RouterHandler.swap.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // ---------------------------------------------------------------------
    // Stateful fuzz invariants (I1–I5, I7)
    // ---------------------------------------------------------------------

    /// I1: router holds ~zero residual of touched tokens after each settled execute (delta-zero).
    function invariant_I1_zeroResidual() public view {
        assertEq(tin.balanceOf(address(router)), 0, "I1: residual tin in router");
        assertEq(tout.balanceOf(address(router)), 0, "I1: residual tout in router");
    }

    /// I2: recipient receives >= declared minOut, or the whole tx reverts (never partial).
    function invariant_I2_minOutHonored() public view {
        assertTrue(handler.ghost_minOutHonored(), "I2: a settled swap delivered < minOut");
    }

    /// I3: user never spends more than was pulled (sum pulled == user balance decrease).
    function invariant_I3_spendBounded() public view {
        assertEq(
            handler.ghost_pulled(),
            USER_INITIAL - tin.balanceOf(user),
            "I3: pulled != user tin debit"
        );
    }

    /// I4: protocol fee is exact (floor(gross*feeBps/10000)), capped, and only feeRecipient gets it.
    function invariant_I4_feeExactAndCapped() public view {
        uint256 feeOut = handler.ghost_feeOut();
        uint256 recipientOut = handler.ghost_recipientOut();
        uint256 grossOut = recipientOut + feeOut;

        // Fee bound: since the per-swap fee rounds down, feeOut*10000 <= grossOut*feeBps.
        assertLe(feeOut * Constants.BPS_DENOMINATOR, grossOut * FEE_BPS, "I4: fee exceeds bps bound");
        // Configured fee never exceeds the protocol cap.
        assertLe(FEE_BPS, Constants.MAX_FEE_BPS, "I4: feeBps above MAX_FEE_BPS");
        // No fee leaked elsewhere: feeRecipient's tout balance is exactly the accrued fee.
        assertEq(tout.balanceOf(feeRecipient), feeOut, "I4: fee leaked outside feeRecipient");
    }

    /// I5: every minted tout ends at {recipient, feeRecipient} only (router/venue/burn hold 0).
    function invariant_I5_conservation() public view {
        uint256 supply = tout.totalSupply();
        uint256 held = tout.balanceOf(recipient)
            + tout.balanceOf(feeRecipient)
            + tout.balanceOf(address(router))
            + tout.balanceOf(address(v3))
            + tout.balanceOf(address(0xdead)); // MockERC20 fee-on-transfer sink (unused here)
        assertEq(supply, held, "I5: tout reached an unexpected holder");
        // No third party (incl. the fuzzing user) ever holds tout.
        assertEq(tout.balanceOf(user), 0, "I5: user holds tout");
        assertEq(tout.balanceOf(address(handler)), 0, "I5: handler holds tout");
        // Recipient + feeRecipient account for the entire supply (venue/router/burn are 0).
        assertEq(
            tout.balanceOf(recipient) + tout.balanceOf(feeRecipient),
            supply,
            "I5: supply not fully held by {recipient, feeRecipient}"
        );
    }

    /// I7: only the whitelisted immutable venue is ever the caller recorded by the mock.
    function invariant_I7_onlyWhitelistedVenue() public view {
        address last = v3.lastCaller();
        assertTrue(last == address(router) || last == address(0), "I7: unexpected venue caller");
    }

    // ---------------------------------------------------------------------
    // Deterministic unit tests for I6 (pause / deadline) and I8 (cap)
    // ---------------------------------------------------------------------

    function _pullProgram(uint160 amount)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tin),
                amount: amount,
                expiration: uint48(block.timestamp + 1 days),
                nonce: 0
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);
        commands = abi.encodePacked(bytes1(0x00), bytes1(0x01));
        inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(tin), amount);
    }

    function _settlement(address buyToken, uint256 minOut, address to)
        internal
        pure
        returns (DogeSwapRouter.Settlement memory)
    {
        return DogeSwapRouter.Settlement({buyToken: buyToken, minOut: minOut, recipient: to});
    }

    /// I6: when paused, execute always reverts (no state change).
    function test_I6_pausedReverts() public {
        vm.prank(guardian);
        router.pause();

        (bytes memory commands, bytes[] memory inputs) = _pullProgram(uint160(10 ether));
        uint256 userBefore = tin.balanceOf(user);

        vm.prank(user);
        vm.expectRevert(); // Pausable: EnforcedPause
        router.execute(commands, inputs, _settlement(address(0), 0, address(0)), block.timestamp + 1);

        assertEq(tin.balanceOf(user), userBefore, "I6: paused execute changed state");
        assertEq(tin.balanceOf(address(router)), 0, "I6: paused execute pulled funds");
    }

    /// I6: when the deadline is in the past, execute always reverts (no state change).
    function test_I6_expiredDeadlineReverts() public {
        (bytes memory commands, bytes[] memory inputs) = _pullProgram(uint160(10 ether));
        uint256 userBefore = tin.balanceOf(user);

        vm.warp(1_000);
        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.DeadlineExpired.selector);
        router.execute(commands, inputs, _settlement(address(0), 0, address(0)), block.timestamp - 1);

        assertEq(tin.balanceOf(user), userBefore, "I6: expired execute changed state");
        assertEq(tin.balanceOf(address(router)), 0, "I6: expired execute pulled funds");
    }

    /// I8: aggregate input within one execute exceeding the active cap reverts NotionalCapExceeded.
    function test_I8_aggregateInputOverCapReverts() public {
        vm.prank(owner);
        router.setMaxInputPerTx(address(tin), 120 ether);

        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tin),
                amount: uint160(200 ether),
                expiration: uint48(block.timestamp + 1 days),
                nonce: 0
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);

        // two pulls of 80 each -> 160 aggregate > 120 cap
        bytes memory commands = abi.encodePacked(bytes1(0x00), bytes1(0x01), bytes1(0x01));
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(tin), uint160(80 ether));
        inputs[2] = abi.encode(address(tin), uint160(80 ether));

        uint256 userBefore = tin.balanceOf(user);
        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.NotionalCapExceeded.selector);
        router.execute(commands, inputs, _settlement(address(0), 0, address(0)), block.timestamp + 1);

        assertEq(tin.balanceOf(user), userBefore, "I8: capped execute changed state");
        assertEq(tin.balanceOf(address(router)), 0, "I8: capped execute pulled funds");
    }

    /// I8: a single pull at exactly the cap succeeds (boundary is inclusive).
    function test_I8_inputAtCapSucceeds() public {
        vm.prank(owner);
        router.setMaxInputPerTx(address(tin), 120 ether);

        (bytes memory commands, bytes[] memory inputs) = _pullProgram(uint160(120 ether));
        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(0), 0, address(0)), block.timestamp + 1);

        assertEq(tin.balanceOf(address(router)), 120 ether, "I8: at-cap pull did not settle");
    }
}
