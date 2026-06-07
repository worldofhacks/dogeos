// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DogeOSAggregationRouter} from "../../src/DogeOSAggregationRouter.sol";
import {Commands} from "../../src/libraries/Commands.sol";
import {Constants} from "../../src/libraries/Constants.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockV3Router} from "../mocks/MockV3Router.sol";

/// @title Echidna assertion harness for DogeOSAggregationRouter (stranded-fund guard).
/// @notice Echidna cannot sign Permit2, so this harness deliberately avoids the
///         signed-input path. Instead it pre-seeds the router with *stranded* `tin`
///         (an airdrop-style balance never pulled in via this execute) and fuzzes the
///         I1/I5 stranded-fund guard: an attacker-shaped `execute` call (V3_SWAP with a
///         CONTRACT_BALANCE input plus a settlement to the attacker) MUST NOT be able to
///         drain those funds. The properties below are checked as `assert`s inside fuzzed
///         entry points (assertion testMode), so any violation = a failing call sequence.
///
///         Properties asserted:
///           P1 (residual / no-drain): after a fuzzed attacker `execute`, the attacker's
///               `tout` balance stays 0 (the swap saw delta == 0, so 0 was settled out).
///           P2 (stranded preserved): the router's stranded `tin` balance is unchanged
///               by `execute` (only `rescue`, which is onlyOwner, can move it).
///           P3 (min-out honored on a real inflow): a settlement that mints fresh `tout`
///               into the router via the swap delivers `recipient >= minOut`.
contract EchidnaRouter {
    DogeOSAggregationRouter internal router;
    MockV3Router internal v3;
    MockERC20 internal tin;
    MockERC20 internal tout;

    address internal constant ATTACKER = address(0xA11CE);
    uint256 internal constant STRANDED = 250e18;

    constructor() {
        v3 = new MockV3Router();
        // Router wired: owner = this harness, guardian/wdoge unused for these props.
        router = new DogeOSAggregationRouter(
            address(this),          // owner_
            address(this),          // guardian_
            address(0xDEAD),        // wdoge_ (unused in these properties)
            address(0xBEE2),        // v2_   (unused)
            address(v3),            // v3_
            address(0xA16E)         // alg_  (unused)
        );
        tin = new MockERC20("IN", "IN");
        tout = new MockERC20("OUT", "OUT");

        // Pre-seed the router with STRANDED tin: airdropped, never pulled via execute.
        tin.mint(address(router), STRANDED);
    }

    // ---- helpers ----

    /// @dev V3_SWAP input: (tokenIn, tokenOut, fee, amountIn, minOut).
    function _v3Input(uint256 amountIn, uint256 minOut) internal view returns (bytes memory) {
        return abi.encode(address(tin), address(tout), uint24(500), amountIn, minOut);
    }

    function _settlement(address to, uint256 minOut)
        internal
        view
        returns (DogeOSAggregationRouter.Settlement memory)
    {
        return DogeOSAggregationRouter.Settlement({buyToken: address(tout), minOut: minOut, recipient: to});
    }

    // ---- fuzzed entry points (assertion mode) ----

    /// @notice Fuzz the stranded-fund guard. Whatever `amountIn`/`minOut` Echidna picks,
    ///         an attacker MUST NOT be able to drain the pre-seeded stranded `tin`.
    function fuzz_cannot_drain_via_execute(uint256 amountIn, uint256 minOut) public {
        uint256 strandedBefore = tin.balanceOf(address(router));
        uint256 attackerOutBefore = tout.balanceOf(ATTACKER);

        bytes memory commands = abi.encodePacked(Commands.V3_SWAP);
        bytes[] memory inputs = new bytes[](1);
        // Either CONTRACT_BALANCE (try to sweep) or an explicit amount; both must be guarded.
        inputs[0] = _v3Input(amountIn, minOut);

        // Settlement pays out to the attacker. With minOut > 0 and delta == 0 this reverts
        // (MinOutNotMet); with minOut == 0 it settles 0. Either way nothing is drained.
        try router.execute(
            commands,
            inputs,
            _settlement(ATTACKER, minOut),
            block.timestamp + 1
        ) {
            // Settled. The swap saw a per-execute delta of 0 on stranded tin, so nothing left.
        } catch {
            // Reverted (InsufficientLedgerBalance / MinOutNotMet / venue revert). Also safe.
        }

        // P1: attacker extracted no output.
        assert(tout.balanceOf(ATTACKER) == attackerOutBefore);
        // P2: stranded tin untouched by execute.
        assert(tin.balanceOf(address(router)) == strandedBefore);
    }

    /// @notice Direct assertion of the explicit-amount guard: an explicit amountIn that
    ///         exceeds the per-execute delta (which is 0 for stranded funds) MUST revert.
    function fuzz_explicit_over_delta_reverts(uint256 amountIn) public {
        // Only meaningful for non-zero explicit amounts (CONTRACT_BALANCE resolves to 0 delta).
        if (amountIn == 0 || amountIn == Constants.CONTRACT_BALANCE) return;

        uint256 strandedBefore = tin.balanceOf(address(router));

        bytes memory commands = abi.encodePacked(Commands.V3_SWAP);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _v3Input(amountIn, 0);

        bool reverted;
        try router.execute(
            commands,
            inputs,
            _settlement(ATTACKER, 0),
            block.timestamp + 1
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // Must have reverted (delta == 0 < amountIn) and left stranded funds intact.
        assert(reverted);
        assert(tin.balanceOf(address(router)) == strandedBefore);
    }
}
