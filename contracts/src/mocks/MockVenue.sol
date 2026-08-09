// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISproutVenue} from "../interfaces/ISproutVenue.sol";
import {MockPriceFeed} from "./MockPriceFeed.sol";

/// @notice Local mock trading venue. Prices come from per-token feeds and are
///         deliberately distinct from oracle valuations elsewhere: the venue
///         applies a configurable price impact so slippage paths can be tested.
contract MockVenue is ISproutVenue, Ownable {
    using SafeERC20 for IERC20;

    mapping(address => MockPriceFeed) public feeds;
    mapping(address => bool) public supported;
    uint256 public priceImpactBps;
    uint256 public maxStaleness = 1 hours;

    event FeedSet(address indexed token, address indexed feed);
    event PriceImpactSet(uint256 bps);

    constructor() Ownable(msg.sender) {}

    function setFeed(address token, MockPriceFeed feed) external onlyOwner {
        require(address(feed) != address(0), "feed=0");
        feeds[token] = feed;
        supported[token] = true;
        emit FeedSet(token, address(feed));
    }

    function setPriceImpact(uint256 bps) external onlyOwner {
        require(bps < 10_000, "bps");
        priceImpactBps = bps;
        emit PriceImpactSet(bps);
    }

    function setMaxStaleness(uint256 seconds_) external onlyOwner {
        maxStaleness = seconds_;
    }

    function _price(address token) internal view returns (uint256 price, uint8 decimals) {
        MockPriceFeed feed = feeds[token];
        require(address(feed) != address(0), "NO_FEED");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "BAD_PRICE");
        require(answeredInRound >= roundId, "BAD_ROUND");
        require(updatedAt <= block.timestamp, "FUTURE_PRICE");
        require(block.timestamp - updatedAt <= maxStaleness, "STALE_PRICE");
        return (uint256(answer), feed.decimals());
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view override returns (uint256) {
        require(supported[tokenIn] && supported[tokenOut], "UNSUPPORTED");
        (uint256 priceIn, uint8 feedDecIn) = _price(tokenIn);
        (uint256 priceOut, uint8 feedDecOut) = _price(tokenOut);
        uint8 decIn = IERC20Metadata(tokenIn).decimals();
        uint8 decOut = IERC20Metadata(tokenOut).decimals();
        require(feedDecIn <= 36 && feedDecOut <= 36 && decIn <= 36 && decOut <= 36, "DEC");

        uint256 out = (amountIn * priceIn * (10 ** uint256(decOut))) / ((10 ** uint256(decIn)) * priceOut);
        out = (out * (10_000 - priceImpactBps)) / 10_000;
        return out;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        override
        returns (uint256 amountOut)
    {
        require(recipient != address(0), "recipient=0");
        amountOut = quote(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "SLIPPAGE");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
