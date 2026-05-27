// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDogeOSSwapAdapter} from "../../src/interfaces/IDogeOSSwapAdapter.sol";

contract MockSwapAdapter is IDogeOSSwapAdapter {
    using SafeERC20 for IERC20;

    uint256 public amountOut;
    bool public reenter;
    address public router;
    address public callbackAdapter;
    IDogeOSSwapAdapter.ExactInputParams public callbackParams;
    uint256 public callbackDeadline;

    function setAmountOut(uint256 amountOut_) external {
        amountOut = amountOut_;
    }

    function setReentry(
        address router_,
        address adapter_,
        IDogeOSSwapAdapter.ExactInputParams calldata params_,
        uint256 deadline_
    ) external {
        reenter = true;
        router = router_;
        callbackAdapter = adapter_;
        callbackParams = params_;
        callbackDeadline = deadline_;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256) {
        if (reenter) {
            reenter = false;
            (bool ok, ) = router.call(
                abi.encodeWithSignature(
                    "exactInput(address,((address,address,address,uint256,uint256,bytes)),uint256)",
                    callbackAdapter,
                    callbackParams,
                    callbackDeadline
                )
            );
            require(!ok, "REENTRY_SUCCEEDED");
        }

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
        return amountOut;
    }
}
