// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

/// @notice Local mock of a Uniswap V3 SwapRouter02. Rates are set by the test
///         owner and liquidity is pre-funded. It can deliberately underpay while
///         reporting a large output, to prove the vault measures the real balance
///         delta instead of trusting the returned value.
contract MockSwapRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) public rateE18;
    mapping(address => mapping(address => bool)) public configured;

    bool public shortPayAndReportHigh;
    uint256 public shortPayDivisor = 100;

    function setRate(address tokenIn, address tokenOut, uint256 outPerInE18) external {
        rateE18[tokenIn][tokenOut] = outPerInE18;
        configured[tokenIn][tokenOut] = true;
    }

    function setShortPay(bool enabled, uint256 divisor) external {
        shortPayAndReportHigh = enabled;
        if (divisor > 0) shortPayDivisor = divisor;
    }

    function quotedOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint8 decIn = IERC20Metadata(tokenIn).decimals();
        uint8 decOut = IERC20Metadata(tokenOut).decimals();
        return (amountIn * rateE18[tokenIn][tokenOut] * (10 ** uint256(decOut))) / ((10 ** uint256(decIn)) * 1e18);
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable override returns (uint256 amountOut) {
        require(configured[params.tokenIn][params.tokenOut], "NO_POOL");
        amountOut = quotedOut(params.tokenIn, params.tokenOut, params.amountIn);
        require(amountOut >= params.amountOutMinimum, "Too little received");

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        if (shortPayAndReportHigh && shortPayDivisor > 0) {
            IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut / shortPayDivisor);
            return amountOut * shortPayDivisor;
        }
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
