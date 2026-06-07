// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

contract PermitSignature {
    bytes32 public constant _PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 public constant _PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    function getPermitSignature(
        IAllowanceTransfer.PermitSingle memory permit, uint256 privateKey, bytes32 domainSeparator, Vm vm
    ) internal pure returns (bytes memory sig) {
        bytes32 detailsHash = keccak256(abi.encode(_PERMIT_DETAILS_TYPEHASH, permit.details));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator,
            keccak256(abi.encode(_PERMIT_SINGLE_TYPEHASH, detailsHash, permit.spender, permit.sigDeadline))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return bytes.concat(r, s, bytes1(v));
    }
}
