// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable2Step, Ownable} from "openzeppelin/access/Ownable2Step.sol";

/// @title DogeSwapRegistry
/// @author DogeOS
/// @notice On-chain pointer to the current canonical DogeSwapRouter deployment.
/// @dev The aggregation router is immutable (non-upgradeable): a router "upgrade" is a fresh
///      deployment. Off-chain integrators (the web app, indexers, partner front-ends) read
///      `currentRouter()` here to discover the live router without redeploying themselves, and
///      `version()` lets them detect a migration. Ownership is `Ownable2Step` so the pointer is
///      controlled by the project Safe (the registry owner is transferred to `ROUTER_SAFE` at
///      deploy time). Pointing the registry at a new router is a single, auditable, two-step-owned
///      action — it does NOT move funds and does NOT touch the router's own governance.
contract DogeSwapRegistry is Ownable2Step {
    /// @notice The address of the current canonical aggregation router.
    address public currentRouter;
    /// @notice Monotonically increasing counter, incremented on every `setCurrentRouter` call.
    /// @dev Lets integrators detect that the pointer changed (cache-busting) without comparing addresses.
    uint256 public version;

    /// @notice Emitted whenever the current router pointer is updated.
    /// @param router The new current router address.
    /// @param version The new version number (post-increment).
    event RouterUpdated(address indexed router, uint256 version);

    /// @notice Deploys the registry with an initial owner.
    /// @param owner_ The initial owner (intended to become the project Safe, `ROUTER_SAFE`).
    constructor(address owner_) Ownable(owner_) {}

    /// @notice Sets the current canonical router and bumps the version. Owner-only.
    /// @param router The new current router address.
    function setCurrentRouter(address router) external onlyOwner {
        currentRouter = router;
        version += 1;
        emit RouterUpdated(router, version);
    }
}
