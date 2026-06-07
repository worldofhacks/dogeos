// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {MockWDOGE} from "./mocks/MockWDOGE.sol";
import {RevertOnReceive} from "./mocks/RevertOnReceive.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterEdgesTest is Test, DeployPermit2, PermitSignature {
    IAllowanceTransfer internal permit2;
    DogeSwapRouter internal router;
    MockV3Router internal v3;
    MockWDOGE internal wdoge;
    MockERC20 internal tin;
    MockERC20 internal tout;

    address internal owner = makeAddr("owner");
    address internal recipient = makeAddr("recipient");
    address internal user;
    uint256 internal userPk;

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        wdoge = new MockWDOGE();
        v3 = new MockV3Router();
        router = new DogeSwapRouter(
            owner, makeAddr("g"), address(wdoge), makeAddr("v2"), address(v3), makeAddr("alg")
        );
        tin = new MockERC20("IN", "IN");
        tout = new MockERC20("OUT", "OUT");
        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, 1000e18);
        vm.prank(user);
        tin.approve(address(permit2), type(uint256).max);
    }

    // ---- helpers ----

    function _settlement(address buyToken, uint256 minOut, address to)
        internal
        pure
        returns (DogeSwapRouter.Settlement memory)
    {
        return DogeSwapRouter.Settlement({buyToken: buyToken, minOut: minOut, recipient: to});
    }

    function _noop() internal pure returns (DogeSwapRouter.Settlement memory) {
        return DogeSwapRouter.Settlement({buyToken: address(0), minOut: 0, recipient: address(0)});
    }

    /// @dev Build a freshly-signed Permit2 PermitSingle for `tin` at `nonce` and its signature.
    function _permitSingle(uint160 amount, uint48 nonce, uint48 expiration)
        internal
        view
        returns (IAllowanceTransfer.PermitSingle memory p, bytes memory sig)
    {
        p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tin),
                amount: amount,
                expiration: expiration,
                nonce: nonce
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);
    }

    /// @dev [PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM] pulling `amount` of tin (nonce 0, long expiry).
    function _pullProgram(uint160 amount)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            _permitSingle(amount, 0, uint48(block.timestamp + 1 days));
        commands = abi.encodePacked(bytes1(0x00), bytes1(0x01));
        inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(tin), amount);
    }

    function _v3Input(address inTok, address outTok, uint24 fee, uint256 amountIn, uint256 minOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(inTok, outTok, fee, amountIn, minOut);
    }

    // ===== tests =====

    // 1. WRAP_NATIVE then V3 swap WDOGE -> tout.
    function test_wrapNative_then_swap_to_token() public {
        vm.deal(user, 5 ether);

        bytes memory commands = abi.encodePacked(bytes1(0x05), bytes1(0x03)); // WRAP_NATIVE, V3_SWAP
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(Constants.CONTRACT_BALANCE); // wrap all native brought in
        inputs[1] = _v3Input(address(wdoge), address(tout), uint24(500), Constants.CONTRACT_BALANCE, 0);

        vm.prank(user);
        router.execute{value: 5 ether}(
            commands, inputs, _settlement(address(tout), 0, recipient), block.timestamp + 1 hours
        );

        // 5e18 wrapped -> 5e18 WDOGE -> 5e18 * 0.995 = 4.975e18 tout.
        assertEq(tout.balanceOf(recipient), (5e18 * 9950) / 10_000, "recipient receives 5*0.995 tout");
        assertEq(wdoge.balanceOf(address(router)), 0, "no residual WDOGE");
        assertEq(address(router).balance, 0, "no residual native");
    }

    // 2. tin -> WDOGE (V3), UNWRAP_NATIVE, settle native to an EOA recipient.
    function test_nativeOutput_swap_unwrap_settleNative() public {
        vm.deal(address(wdoge), 1000 ether); // back withdraws

        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory v3In = _v3Input(address(tin), address(wdoge), uint24(500), Constants.CONTRACT_BALANCE, 0);
        bytes memory unwrapIn = abi.encode(Constants.CONTRACT_BALANCE);

        bytes memory commands = abi.encodePacked(pc, bytes1(0x03), bytes1(0x06)); // ..., V3_SWAP, UNWRAP_NATIVE
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = pi[0];
        inputs[1] = pi[1];
        inputs[2] = v3In;
        inputs[3] = unwrapIn;

        uint256 before = recipient.balance;

        vm.prank(user);
        router.execute(
            commands, inputs, _settlement(Constants.NATIVE, 0, recipient), block.timestamp + 1 hours
        );

        uint256 expected = (100e18 * 9950) / 10_000; // 99.5e18
        assertEq(recipient.balance - before, expected, "recipient receives 100*0.995 native");
        assertEq(address(router).balance, 0, "no residual native in router");
        assertEq(wdoge.balanceOf(address(router)), 0, "no residual WDOGE");
    }

    // 3. WRAP_NATIVE counts toward the NATIVE aggregate cap.
    function test_wrapNative_overCap_reverts() public {
        vm.prank(owner);
        router.setMaxInputPerTx(Constants.NATIVE, 3 ether);
        vm.deal(user, 5 ether);

        bytes memory commands = abi.encodePacked(bytes1(0x05)); // WRAP_NATIVE
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(Constants.CONTRACT_BALANCE); // wraps 5 > 3 cap

        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.NotionalCapExceeded.selector);
        router.execute{value: 5 ether}(commands, inputs, _noop(), block.timestamp + 1 hours);
    }

    // 4. Fee-on-transfer output token: settlement payout uses balance delta.
    function test_feeOnTransfer_outputToken_balanceDelta() public {
        tout.setFeeBps(100); // 1% FoT on transfer

        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory v3In = _v3Input(address(tin), address(tout), uint24(500), Constants.CONTRACT_BALANCE, 0);

        bytes memory commands = abi.encodePacked(pc, bytes1(0x03)); // ..., V3_SWAP
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = pi[0];
        inputs[1] = pi[1];
        inputs[2] = v3In;

        vm.prank(user);
        router.execute(
            commands, inputs, _settlement(address(tout), 0, recipient), block.timestamp + 1 hours
        );

        // V3 mint (not FoT) lands 99.5e18 in router; settlement transfer applies 1% FoT.
        uint256 gross = (100e18 * 9950) / 10_000; // 99.5e18 minted to router
        uint256 received = gross - (gross * 100) / 10_000; // recipient nets 99% of 99.5e18
        assertEq(tout.balanceOf(recipient), received, "recipient nets gross minus 1% FoT");
        assertEq(tout.balanceOf(address(router)), 0, "no residual tout in router");
    }

    // 5. Live Permit2 allowance: a bare TRANSFER_FROM (no new signature) works within the window.
    function test_permit2_liveAllowance_bareTransferFrom_succeeds() public {
        // execute #1: establish a 200e18 allowance via PERMIT2_PERMIT (nonce 0), no-op settlement.
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            _permitSingle(uint160(200e18), 0, uint48(block.timestamp + 1 days));
        bytes memory permitCmd = abi.encodePacked(bytes1(0x00));
        bytes[] memory permitInputs = new bytes[](1);
        permitInputs[0] = abi.encode(p, sig);

        vm.prank(user);
        router.execute(permitCmd, permitInputs, _noop(), block.timestamp + 1 hours);

        (uint160 amt,,) = permit2.allowance(user, address(tin), address(router));
        assertEq(amt, 200e18, "allowance established at 200e18");

        // execute #2: bare PERMIT2_TRANSFER_FROM only (no permit) pulls 100e18 — no new signature.
        bytes memory tfCmd = abi.encodePacked(bytes1(0x01));
        bytes[] memory tfInputs = new bytes[](1);
        tfInputs[0] = abi.encode(address(tin), uint160(100e18));

        vm.prank(user);
        router.execute(tfCmd, tfInputs, _noop(), block.timestamp + 1 hours);

        assertEq(tin.balanceOf(address(router)), 100e18, "router pulled 100e18 with no new signature");
        assertEq(tin.balanceOf(user), 900e18, "user debited 100e18");
    }

    // 6. Expired Permit2 allowance: a bare TRANSFER_FROM after expiration reverts.
    function test_permit2_expiredAllowance_bareTransferFrom_reverts() public {
        // permit with expiration = now + 1.
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) =
            _permitSingle(uint160(200e18), 0, uint48(block.timestamp + 1));
        bytes memory permitCmd = abi.encodePacked(bytes1(0x00));
        bytes[] memory permitInputs = new bytes[](1);
        permitInputs[0] = abi.encode(p, sig);

        vm.prank(user);
        router.execute(permitCmd, permitInputs, _noop(), block.timestamp + 1 hours);

        vm.warp(block.timestamp + 2); // past the allowance expiration

        bytes memory tfCmd = abi.encodePacked(bytes1(0x01));
        bytes[] memory tfInputs = new bytes[](1);
        tfInputs[0] = abi.encode(address(tin), uint160(100e18));

        vm.prank(user);
        vm.expectRevert();
        router.execute(tfCmd, tfInputs, _noop(), block.timestamp + 1 hours);
    }

    // 7. Native-output settlement to a contract that rejects native reverts the whole tx.
    function test_nativeRecipient_revertOnReceive_revertsWholeTx() public {
        vm.deal(address(wdoge), 1000 ether);
        address badRecipient = address(new RevertOnReceive());

        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory v3In = _v3Input(address(tin), address(wdoge), uint24(500), Constants.CONTRACT_BALANCE, 0);
        bytes memory unwrapIn = abi.encode(Constants.CONTRACT_BALANCE);

        bytes memory commands = abi.encodePacked(pc, bytes1(0x03), bytes1(0x06));
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = pi[0];
        inputs[1] = pi[1];
        inputs[2] = v3In;
        inputs[3] = unwrapIn;

        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.NativeTransferFailed.selector);
        router.execute(
            commands, inputs, _settlement(Constants.NATIVE, 0, badRecipient), block.timestamp + 1 hours
        );
    }

    // 8. receive() rejects native from anyone but WDOGE.
    function test_receive_rejectsNonWdoge() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "router rejects direct native from non-WDOGE");
    }
}
