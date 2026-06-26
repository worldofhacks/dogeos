// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockV2Router} from "./mocks/MockV2Router.sol";
import {MockV3Router} from "./mocks/MockV3Router.sol";
import {MockAlgebraRouter} from "./mocks/MockAlgebraRouter.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterSwapsIntegrationTest is Test, DeployPermit2, PermitSignature {
    IAllowanceTransfer internal permit2;
    DogeSwapRouter internal router;
    MockV2Router internal v2;
    MockV3Router internal v3;
    MockAlgebraRouter internal alg;
    MockERC20 internal tin;
    MockERC20 internal tout;

    address internal owner = makeAddr("owner");
    address internal recipient = makeAddr("recipient");
    address internal user;
    uint256 internal userPk;

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        v2 = new MockV2Router();
        v3 = new MockV3Router();
        alg = new MockAlgebraRouter();
        router = new DogeSwapRouter(
            owner, makeAddr("g"), makeAddr("w"), address(v2), address(v3), address(alg)
        );
        tin = new MockERC20("IN", "IN");
        tout = new MockERC20("OUT", "OUT");
        (user, userPk) = makeAddrAndKey("user");
        tin.mint(user, 1000e18);
        vm.prank(user);
        tin.approve(address(permit2), type(uint256).max);
    }

    // ---- helpers ----

    /// @dev Settlement that enforces fee/minOut/payout/refund.
    function _settlement(address buyToken, uint256 minOut, address to)
        internal
        pure
        returns (DogeSwapRouter.Settlement memory)
    {
        return DogeSwapRouter.Settlement({buyToken: buyToken, minOut: minOut, recipient: to});
    }

    /// @dev Build a freshly-signed Permit2 PermitSingle for `tin` (nonce 0) and its signature.
    function _permitSingle(uint160 amount)
        internal
        view
        returns (IAllowanceTransfer.PermitSingle memory p, bytes memory sig)
    {
        p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tin),
                amount: amount,
                expiration: uint48(block.timestamp + 1 days),
                nonce: 0
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);
    }

    /// @dev Commands/inputs prefix that pulls `amount` of `tin` into the ledger this execute:
    ///      [PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM].
    function _pullProgram(uint160 amount)
        internal
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) = _permitSingle(amount);
        commands = abi.encodePacked(bytes1(0x00), bytes1(0x01)); // PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM
        inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(tin), amount);
    }

    /// @dev Append a single swap command + input to the pull prefix.
    function _assemble(bytes memory pullCmds, bytes[] memory pullInputs, bytes1 cmd, bytes memory swapInput)
        internal
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        commands = abi.encodePacked(pullCmds, cmd);
        uint256 n = pullInputs.length;
        inputs = new bytes[](n + 1);
        for (uint256 i; i < n; ++i) inputs[i] = pullInputs[i];
        inputs[n] = swapInput;
    }

    /// @dev Append two swap commands + inputs to the pull prefix.
    function _assemble2(
        bytes memory pullCmds,
        bytes[] memory pullInputs,
        bytes1 c1,
        bytes memory in1,
        bytes1 c2,
        bytes memory in2
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        commands = abi.encodePacked(pullCmds, c1, c2);
        uint256 n = pullInputs.length;
        inputs = new bytes[](n + 2);
        for (uint256 i; i < n; ++i) inputs[i] = pullInputs[i];
        inputs[n] = in1;
        inputs[n + 1] = in2;
    }

    function _v2Input(uint256 amountIn, uint256 minOut, address t0, address t1) internal pure returns (bytes memory) {
        address[] memory path = new address[](2);
        path[0] = t0;
        path[1] = t1;
        return abi.encode(amountIn, minOut, path);
    }

    // ===== tests =====

    // 1. V2 single swap, 100 in -> 99 out (0.99 rate).
    function test_v2_singleSwap() public {
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        (bytes memory commands, bytes[] memory inputs) = _assemble(
            pc, pi, bytes1(0x02), _v2Input(Constants.CONTRACT_BALANCE, 0, address(tin), address(tout))
        );

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 98e18, recipient), block.timestamp + 1 hours);

        assertEq(tout.balanceOf(recipient), 99e18, "recipient receives 100*0.99");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
        assertEq(tout.balanceOf(address(router)), 0, "no residual tout");
        assertEq(v2.lastCaller(), address(router), "venue called by router");
    }

    // 2. V3 single swap, 100 in -> 99.5 out (0.995 rate).
    function test_v3_singleSwap() public {
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory swapInput =
            abi.encode(address(tin), address(tout), uint24(500), Constants.CONTRACT_BALANCE, uint256(0));
        (bytes memory commands, bytes[] memory inputs) = _assemble(pc, pi, bytes1(0x03), swapInput);

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 99e18, recipient), block.timestamp + 1 hours);

        assertEq(tout.balanceOf(recipient), 99.5e18, "recipient receives 100*0.995");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
        assertEq(tout.balanceOf(address(router)), 0, "no residual tout");
    }

    // 3. Algebra single swap, 100 in -> 99.6 out (0.996 rate); deployer threaded through.
    function test_algebra_singleSwap() public {
        address deployer = makeAddr("dep");
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory swapInput =
            abi.encode(address(tin), address(tout), deployer, Constants.CONTRACT_BALANCE, uint256(0));
        (bytes memory commands, bytes[] memory inputs) = _assemble(pc, pi, bytes1(0x04), swapInput);

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 99e18, recipient), block.timestamp + 1 hours);

        assertEq(tout.balanceOf(recipient), 99.6e18, "recipient receives 100*0.996");
        assertEq(alg.lastDeployer(), deployer, "deployer threaded to venue");
    }

    // 4. HIGH FIX PROOF: stranded router funds cannot be swapped (delta=0 => amountIn 0 => no output).
    function test_contractBalance_cannotDrainStranded() public {
        tin.mint(address(router), 250e18); // stranded, never pulled this execute
        address attacker = makeAddr("attacker");

        bytes memory commands = abi.encodePacked(bytes1(0x02)); // V2_SWAP only
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _v2Input(Constants.CONTRACT_BALANCE, 0, address(tin), address(tout));

        vm.prank(attacker);
        router.execute(commands, inputs, _settlement(address(tout), 0, attacker), block.timestamp + 1 hours);

        assertEq(tout.balanceOf(attacker), 0, "attacker extracted no output");
        assertEq(tin.balanceOf(address(router)), 250e18, "stranded tin untouched");
    }

    // 5. Explicit amount exceeding the per-execute delta reverts.
    function test_explicitAmount_exceedingDelta_reverts() public {
        tin.mint(address(router), 250e18);
        address attacker = makeAddr("attacker");

        bytes memory commands = abi.encodePacked(bytes1(0x02));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _v2Input(250e18, 0, address(tin), address(tout)); // explicit > delta(0)

        vm.prank(attacker);
        vm.expectRevert(DogeSwapRouter.InsufficientLedgerBalance.selector);
        router.execute(commands, inputs, _settlement(address(tout), 0, attacker), block.timestamp + 1 hours);
    }

    // 6. Fee is taken from gross output in settlement.
    function test_fee_takenInSettlement() public {
        address feeRecipient = makeAddr("feeRecipient");
        vm.prank(owner);
        router.setFee(30, feeRecipient); // 0.3%

        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory swapInput =
            abi.encode(address(tin), address(tout), uint24(500), Constants.CONTRACT_BALANCE, uint256(0));
        (bytes memory commands, bytes[] memory inputs) = _assemble(pc, pi, bytes1(0x03), swapInput);

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 99e18, recipient), block.timestamp + 1 hours);

        uint256 gross = 99.5e18;
        uint256 fee = (gross * 30) / 10_000;
        assertEq(tout.balanceOf(feeRecipient), fee, "fee recipient receives fee");
        assertEq(tout.balanceOf(recipient), gross - fee, "recipient receives gross - fee");
        assertEq(tout.balanceOf(address(router)), 0, "no residual tout");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
    }

    // 6b. FEE-EVASION FIX: declaring a non-output (here the input) token as buyToken
    //     must NOT let the real swap output escape the protocol fee via the refund
    //     path. The fee binds to net-positive OUTPUT deltas, not just buyToken.
    function test_fee_notEvadableByMislabeledBuyToken() public {
        address feeRecipient = makeAddr("feeRecipient2");
        vm.prank(owner);
        router.setFee(30, feeRecipient); // 0.3%

        // Pull 100 tin, swap ALL tin -> tout (V2 rate 0.99 => 99 tout), but mislabel
        // the settlement token as `tin` (zero output delta) with minOut 0. Pre-fix,
        // out=_delta(tin)=0 => fee=0 and tout left fee-free via the refund loop.
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        (bytes memory commands, bytes[] memory inputs) = _assemble(
            pc, pi, bytes1(0x02), _v2Input(Constants.CONTRACT_BALANCE, 0, address(tin), address(tout))
        );

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tin), 0, recipient), block.timestamp + 1 hours);

        uint256 gross = 99e18;
        uint256 fee = (gross * 30) / 10_000;
        assertEq(tout.balanceOf(feeRecipient), fee, "fee still collected on the mislabeled output");
        assertEq(tout.balanceOf(user), gross - fee, "trader (msg.sender) gets output minus fee via refund");
        assertEq(tout.balanceOf(address(router)), 0, "no residual tout");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
    }

    // PERMIT2 FRONT-RUN TOLERANCE: a replayed permit (nonce already consumed by a
    // front-runner) must not brick the bundled swap — the try/catch in
    // _permit2Permit swallows the InvalidNonce and the pull/swap still complete.
    function test_permit2_frontRunNonce_swapStillSucceeds() public {
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        (bytes memory commands, bytes[] memory inputs) = _assemble(
            pc, pi, bytes1(0x02), _v2Input(Constants.CONTRACT_BALANCE, 0, address(tin), address(tout))
        );

        // Attacker front-runs by replaying the user's signed permit directly to
        // Permit2, advancing the user's ordered nonce 0->1 and setting the allowance.
        (IAllowanceTransfer.PermitSingle memory p, bytes memory sig) = _permitSingle(uint160(100e18));
        IAllowanceTransfer(address(permit2)).permit(user, p, sig);

        // The bundled PERMIT2_PERMIT now reverts InvalidNonce internally, but the
        // swap proceeds and completes (pre-fix this whole execute reverted).
        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 98e18, recipient), block.timestamp + 1 hours);
        assertEq(tout.balanceOf(recipient), 99e18, "swap completes despite the front-run permit");
    }

    // 7. Split across V3 (60 explicit) + V2 (remaining via CONTRACT_BALANCE).
    function test_split_v3_plus_v2() public {
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory v3Input =
            abi.encode(address(tin), address(tout), uint24(500), uint256(60e18), uint256(0));
        bytes memory v2Input = _v2Input(Constants.CONTRACT_BALANCE, 0, address(tin), address(tout));
        (bytes memory commands, bytes[] memory inputs) =
            _assemble2(pc, pi, bytes1(0x03), v3Input, bytes1(0x02), v2Input);

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 98e18, recipient), block.timestamp + 1 hours);

        // 60*0.995 + 40*0.99 = 59.7 + 39.6 = 99.3e18
        assertEq(tout.balanceOf(recipient), 99.3e18, "recipient receives split total");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
    }

    // 8. Multi-hop: tin -> mid -> tout, both V3.
    function test_multiHop_twoHops() public {
        MockERC20 mid = new MockERC20("MID", "MID");
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory hop1 =
            abi.encode(address(tin), address(mid), uint24(500), Constants.CONTRACT_BALANCE, uint256(0));
        bytes memory hop2 =
            abi.encode(address(mid), address(tout), uint24(500), Constants.CONTRACT_BALANCE, uint256(0));
        (bytes memory commands, bytes[] memory inputs) =
            _assemble2(pc, pi, bytes1(0x03), hop1, bytes1(0x03), hop2);

        vm.prank(user);
        router.execute(commands, inputs, _settlement(address(tout), 98e18, recipient), block.timestamp + 1 hours);

        // 100*0.995*0.995 = 99.0025e18
        assertEq(tout.balanceOf(recipient), 99.0025e18, "recipient receives two-hop output");
        assertEq(mid.balanceOf(address(router)), 0, "no residual mid");
        assertEq(tin.balanceOf(address(router)), 0, "no residual tin");
    }

    // 9. minOut breach reverts the whole tx.
    function test_minOut_breach_revertsWholeTx() public {
        (bytes memory pc, bytes[] memory pi) = _pullProgram(uint160(100e18));
        bytes memory swapInput =
            abi.encode(address(tin), address(tout), uint24(500), Constants.CONTRACT_BALANCE, uint256(0));
        (bytes memory commands, bytes[] memory inputs) = _assemble(pc, pi, bytes1(0x03), swapInput);

        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.MinOutNotMet.selector);
        router.execute(commands, inputs, _settlement(address(tout), 100e18, recipient), block.timestamp + 1 hours);
    }
}
