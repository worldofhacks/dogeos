// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {DogeOSAggregationRouter} from "../src/DogeOSAggregationRouter.sol";
import {RouterRegistry} from "../src/RouterRegistry.sol";
import {Constants} from "../src/libraries/Constants.sol";
import {TimelockController} from "openzeppelin/governance/TimelockController.sol";

/// @title DeployRouter
/// @author DogeOS
/// @notice One-shot deploy of the DogeOS aggregation stack on DogeOS testnet (chain 6281971):
///         (1) deterministic Permit2 (only if absent), (2) a TimelockController governed by the
///         project Safe, (3) the immutable aggregation router (capped before it is ever live and
///         with `feeBps == 0`), and (4) a RouterRegistry pointer owned by the Safe.
/// @dev Run via `forge script script/DeployRouter.s.sol`. The single broadcast keeps the deployer
///      as the temporary router owner just long enough to set caps, then hands the router owner to
///      the timelock (Ownable2Step -> pending owner = timelock). The FINAL handover
///      (timelock.acceptOwnership() on the router) is a post-deploy governance action executed by
///      the Safe through the timelock — see audit/DEPLOYMENT.md.
contract DeployRouter is Script {
    // -------------------------------------------------------------------------------------------
    // Deterministic deployment (verified on-chain on DogeOS testnet; see audit/CHAIN_FACTS.md)
    // -------------------------------------------------------------------------------------------

    /// @dev Arachnid CREATE2 deterministic-deployment proxy (PRESENT on DogeOS testnet).
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Canonical Permit2 address. The router hardcodes this (Constants.PERMIT2), so Permit2
    ///      MUST land exactly here or the whole stack is broken.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @dev VANITY salt the canonical Permit2 was deployed with on every chain. NOTE: this is NOT
    ///      bytes32(0) — salt 0 with this exact creation code yields a DIFFERENT, non-canonical
    ///      address. Verified: Arachnid deployer + THIS salt + Permit2 creation code (init-code
    ///      hash 0xe2be1e05eedf35dacd66c65c862f8150ff9ab4b6b24b9bbe62be71b6b16cf0f8) ==
    ///      0x000000000022D473030F116dDEE9F6B43aC78BA3. See audit/DEPLOYMENT.md for the derivation.
    bytes32 internal constant PERMIT2_SALT =
        0x0000000000000000000000000000000000000000d3af2663da51c10215000000;

    // -------------------------------------------------------------------------------------------
    // Venues + tokens (verified PRESENT on DogeOS testnet; see audit/CHAIN_FACTS.md)
    // -------------------------------------------------------------------------------------------

    address internal constant WDOGE = 0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE;
    address internal constant MUCHFI_V2_ROUTER = 0xC653e745FC613a03D156DACB924AE8e9148B18dc;
    address internal constant MUCHFI_V3_ROUTER = 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB;
    address internal constant BARKSWAP_ALGEBRA_ROUTER = 0x77147f436cE9739D2A54Ffe428DBe02b90c0205e;
    address internal constant USDC = 0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925;

    function run() external {
        // ---- env ----
        address routerSafe = vm.envAddress("ROUTER_SAFE");
        address routerGuardian = vm.envAddress("ROUTER_GUARDIAN");
        uint256 timelockMinDelay = vm.envUint("TIMELOCK_MIN_DELAY");
        uint256 capDefault = vm.envUint("CAP_DEFAULT");
        // Optional per-token caps and an optional (unverified) USDT address. Default to capDefault.
        uint256 capWdoge = vm.envOr("CAP_WDOGE", capDefault);
        uint256 capUsdc = vm.envOr("CAP_USDC", capDefault);
        uint256 capUsdt = vm.envOr("CAP_USDT", capDefault);
        address usdt = vm.envOr("USDT", address(0)); // set only if a verified USDT address exists

        vm.startBroadcast();

        // ---- 1. Permit2 (deterministic, only if absent) ----
        address permit2 = PERMIT2;
        if (PERMIT2.code.length == 0) {
            bytes memory initCode = vm.getCode("lib/permit2/out/Permit2.sol/Permit2.json");
            (bool ok,) = CREATE2_DEPLOYER.call(bytes.concat(PERMIT2_SALT, initCode));
            require(ok, "permit2 create2 failed");
            require(
                PERMIT2.code.length > 0 && _create2Address(PERMIT2_SALT, keccak256(initCode)) == PERMIT2,
                "permit2 addr mismatch"
            );
            console2.log("Permit2 deployed (deterministic) at", permit2);
        } else {
            console2.log("Permit2 already present at", permit2);
        }

        // ---- 2. TimelockController (Safe is proposer + executor + admin) ----
        address[] memory proposers = new address[](1);
        proposers[0] = routerSafe;
        address[] memory executors = new address[](1);
        executors[0] = routerSafe;
        TimelockController timelock = new TimelockController(timelockMinDelay, proposers, executors, routerSafe);

        // ---- 3. Router (deployer is TEMPORARY owner so it can cap before going live) ----
        DogeOSAggregationRouter router = new DogeOSAggregationRouter(
            msg.sender, // temporary owner = deployer; handed to timelock at step 6
            routerGuardian,
            WDOGE,
            MUCHFI_V2_ROUTER,
            MUCHFI_V3_ROUTER,
            BARKSWAP_ALGEBRA_ROUTER
        );

        // ---- 4. Cap the router BEFORE it is ever live-and-uncapped; assert fee is off ----
        router.setDefaultMaxInputPerTx(capDefault);
        router.setMaxInputPerTx(WDOGE, capWdoge);
        router.setMaxInputPerTx(USDC, capUsdc);
        if (usdt != address(0)) {
            router.setMaxInputPerTx(usdt, capUsdt);
        }
        require(router.feeBps() == 0, "fee must be 0 at deploy");

        // ---- 5. RouterRegistry: point at the router, then hand registry to the Safe ----
        RouterRegistry registry = new RouterRegistry(msg.sender);
        registry.setCurrentRouter(address(router));
        registry.transferOwnership(routerSafe); // Ownable2Step -> Safe must acceptOwnership()

        // ---- 6. Hand the router to governance (Ownable2Step -> pending owner = timelock) ----
        router.transferOwnership(address(timelock));

        vm.stopBroadcast();

        // ---- logs ----
        console2.log("==== DogeOS Aggregation Router deployment ====");
        console2.log("deployer (sender)         ", msg.sender);
        console2.log("Permit2                   ", permit2);
        console2.log("TimelockController        ", address(timelock));
        console2.log("DogeOSAggregationRouter   ", address(router));
        console2.log("RouterRegistry            ", address(registry));
        console2.log("ROUTER_SAFE (registry+TL) ", routerSafe);
        console2.log("ROUTER_GUARDIAN           ", routerGuardian);
        console2.log("defaultMaxInputPerTx      ", capDefault);
        console2.log("router.feeBps()           ", router.feeBps());
        console2.log("router pending owner = TL  (acceptOwnership() pending)");
        console2.log("");
        console2.log("POST-DEPLOY GOVERNANCE (manual, via the Safe):");
        console2.log(" - The Safe schedules+executes timelock.acceptOwnership(router) through the");
        console2.log("   TimelockController so the timelock becomes the router's owner.");
        console2.log(" - The Safe accepts ownership of the RouterRegistry (acceptOwnership()).");
        console2.log(" See audit/DEPLOYMENT.md.");
    }

    /// @dev Computes the CREATE2 address for the Arachnid deployer, a salt, and an init-code hash.
    function _create2Address(bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash))))
        );
    }
}
