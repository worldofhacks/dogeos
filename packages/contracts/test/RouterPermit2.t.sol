// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {DogeSwapRouter} from "../src/DogeSwapRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {PermitSignature} from "./utils/PermitSignature.sol";

contract RouterPermit2Test is Test, DeployPermit2, PermitSignature {
    IAllowanceTransfer internal permit2;
    DogeSwapRouter internal router;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal user;
    uint256 internal userPk;

    function setUp() public {
        permit2 = IAllowanceTransfer(deployPermit2());
        router = new DogeSwapRouter(
            owner, makeAddr("g"), makeAddr("w"), makeAddr("v2"), makeAddr("v3"), makeAddr("alg")
        );
        token = new MockERC20("Tok", "TOK");
        (user, userPk) = makeAddrAndKey("user");
        token.mint(user, 1000e18);
        vm.prank(user);
        token.approve(address(permit2), type(uint256).max);
    }

    // ---- helpers ----
    function _permitSingle(uint160 amount, uint48 nonce)
        internal
        view
        returns (IAllowanceTransfer.PermitSingle memory)
    {
        return IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(token),
                amount: amount,
                expiration: uint48(block.timestamp + 1 days),
                nonce: nonce
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
    }

    function _noop() internal pure returns (DogeSwapRouter.Settlement memory) {
        return DogeSwapRouter.Settlement({buyToken: address(0), minOut: 0, recipient: address(0)});
    }

    function _sign(IAllowanceTransfer.PermitSingle memory p) internal view returns (bytes memory) {
        return getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);
    }

    // 1. permit + transferFrom pulls from the caller (msg.sender), not from any owner field.
    function test_permitAndTransferFrom_pullsFromCaller() public {
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(100e18), 0);
        bytes memory sig = _sign(p);

        bytes memory commands = hex"0001";
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(token), uint160(100e18));

        vm.prank(user);
        router.execute(commands, inputs, _noop(), block.timestamp + 1 hours);

        assertEq(token.balanceOf(address(router)), 100e18, "router pulled 100e18");
        assertEq(token.balanceOf(user), 900e18, "user debited 100e18");
    }

    // 2. CRITICAL FIX PROOF: a third party cannot drain a victim's live Permit2 allowance.
    //    The pull always targets msg.sender (the attacker), who has no allowance/balance.
    function test_thirdParty_cannotDrainVictimAllowance() public {
        // user establishes a live 500e18 allowance to the router via Permit2.
        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(500e18), 0);
        bytes memory sig = _sign(p);

        bytes memory permitCmd = hex"00";
        bytes[] memory permitInputs = new bytes[](1);
        permitInputs[0] = abi.encode(p, sig);

        vm.prank(user);
        router.execute(permitCmd, permitInputs, _noop(), block.timestamp + 1 hours);

        (uint160 amount,,) = permit2.allowance(user, address(token), address(router));
        assertEq(amount, 500e18, "victim allowance is live at 500e18");

        // attacker tries to use ONLY a transferFrom command and route the proceeds to itself.
        address attacker = makeAddr("attacker");
        bytes memory commands = hex"01";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(token), uint160(100e18));
        DogeSwapRouter.Settlement memory s = DogeSwapRouter.Settlement({
            buyToken: address(token), minOut: 0, recipient: attacker
        });

        vm.prank(attacker);
        vm.expectRevert(); // pull is from attacker (no Permit2 allowance/balance) -> reverts
        router.execute(commands, inputs, s, block.timestamp + 1 hours);

        assertEq(token.balanceOf(user), 1000e18, "victim balance unchanged");
        assertEq(token.balanceOf(attacker), 0, "attacker received nothing");
    }

    // 3. HIGH FIX PROOF: stranded / pre-existing router funds are not extractable via settlement.
    //    buyToken entry is snapshotted at execute start, so the settlement delta is 0.
    function test_strandedFunds_notExtractable() public {
        token.mint(address(router), 250e18);

        address attacker = makeAddr("attacker");
        bytes memory commands = "";
        bytes[] memory inputs = new bytes[](0);
        DogeSwapRouter.Settlement memory s = DogeSwapRouter.Settlement({
            buyToken: address(token), minOut: 0, recipient: attacker
        });

        vm.prank(attacker);
        router.execute(commands, inputs, s, block.timestamp + 1 hours);

        assertEq(token.balanceOf(attacker), 0, "attacker extracted nothing");
        assertEq(token.balanceOf(address(router)), 250e18, "stranded funds remain in router");
    }

    // 4. CONTRACT_BALANCE drain via swap is venue-dependent; omitted here and deferred to the
    //    venue test task (do NOT add a venue mock in this file). See report.

    // 5. rescue is owner-only and moves the full balance to the destination.
    function test_rescue_ownerOnly() public {
        token.mint(address(router), 250e18);
        address dest = makeAddr("dest");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        router.rescue(address(token), dest, 250e18);

        vm.prank(owner);
        router.rescue(address(token), dest, 250e18);

        assertEq(token.balanceOf(dest), 250e18, "rescue moved funds to dest");
        assertEq(token.balanceOf(address(router)), 0, "router emptied");
    }

    // 6. the per-tx cap aggregates across multiple pulls within one execute.
    function test_cap_aggregateAcrossPulls() public {
        vm.prank(owner);
        router.setMaxInputPerTx(address(token), 120e18);

        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(200e18), 0);
        bytes memory sig = _sign(p);

        bytes memory commands = hex"000101"; // PERMIT, TRANSFER_FROM, TRANSFER_FROM
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(token), uint160(80e18));
        inputs[2] = abi.encode(address(token), uint160(80e18)); // 160 > 120 cap

        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.NotionalCapExceeded.selector);
        router.execute(commands, inputs, _noop(), block.timestamp + 1 hours);
    }

    // 7. the default cap applies to tokens without a token-specific cap.
    function test_cap_defaultApplies() public {
        vm.prank(owner);
        router.setDefaultMaxInputPerTx(50e18);

        IAllowanceTransfer.PermitSingle memory p = _permitSingle(uint160(100e18), 0);
        bytes memory sig = _sign(p);

        bytes memory commands = hex"0001"; // PERMIT, TRANSFER_FROM
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(address(token), uint160(80e18)); // 80 > 50 default

        vm.prank(user);
        vm.expectRevert(DogeSwapRouter.NotionalCapExceeded.selector);
        router.execute(commands, inputs, _noop(), block.timestamp + 1 hours);
    }
}
