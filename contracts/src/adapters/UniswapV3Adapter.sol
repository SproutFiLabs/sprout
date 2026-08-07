// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISproutVenue} from "../interfaces/ISproutVenue.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IStockToken {
    function oraclePaused() external view returns (bool);
}

/// @title UniswapV3Adapter
/// @notice Narrow, immutable adapter around a Uniswap V3 SwapRouter02. It only
///         supports settlement &lt;-&gt; admitted stock token routes configured at
///         deployment, prices them from an independent Chainlink-style feed, and
///         executes an exact-input single-hop swap. It rejects stale or
///         nonpositive feeds, honours a token's `oraclePaused` signal when
///         present, measures the actual recipient balance delta, and clears the
///         router allowance after every swap.
///
/// @dev Floor split, stated honestly: this adapter does NOT enforce an oracle
///      floor. The vault calls {quote} to derive an independent expected-price
///      floor and enforces it; the adapter enforces only the caller-supplied
///      `minAmountOut` against the measured recipient balance delta. Likewise the
///      feed value for a Robinhood stock token already includes the
///      corporate-action multiplier and is used directly. No live router or feed
///      addresses are baked in here; deploy with verified addresses and admit the
///      result in the vault factory.
contract UniswapV3Adapter is ISproutVenue {
    using SafeERC20 for IERC20;

    uint8 private constant SETTLEMENT_FEED_DECIMALS = 8;
    uint256 private constant SETTLEMENT_PRICE = 1e8;

    address public immutable router;
    address public immutable settlement;
    uint256 public immutable maxStaleness;

    struct TokenConfig {
        address feed;
        uint24 fee;
        bool configured;
    }

    mapping(address => TokenConfig) public tokenConfig;
    address[] private _tokens;

    error BadArguments();
    error Unsupported();
    error BadPrice();
    error StalePrice();
    error Slippage();

    constructor(
        address router_,
        address settlement_,
        address[] memory tokens_,
        address[] memory feeds_,
        uint24[] memory fees_,
        uint256 maxStaleness_
    ) {
        if (router_ == address(0) || settlement_ == address(0)) revert BadArguments();
        if (tokens_.length != feeds_.length || tokens_.length != fees_.length || tokens_.length == 0) {
            revert BadArguments();
        }
        router = router_;
        settlement = settlement_;
        maxStaleness = maxStaleness_ == 0 ? 1 hours : maxStaleness_;

        for (uint256 i = 0; i < tokens_.length; i++) {
            address token = tokens_[i];
            if (token == address(0) || token == settlement_ || feeds_[i] == address(0)) revert BadArguments();
            if (tokenConfig[token].configured) revert BadArguments();
            tokenConfig[token] = TokenConfig({feed: feeds_[i], fee: fees_[i], configured: true});
            _tokens.push(token);
        }
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function isSupported(address token) public view returns (bool) {
        return token == settlement || tokenConfig[token].configured;
    }

    function _decimals(address token) internal view returns (uint8 d) {
        d = IERC20Metadata(token).decimals();
        if (d > 36) revert Unsupported();
    }

    /// @dev Independent oracle price. Settlement is treated as $1 only because no
    ///      settlement feed is configured; that assumption is surfaced by callers.
    function _price(address token) internal view returns (uint256 price, uint8 feedDecimals) {
        if (token == settlement) return (SETTLEMENT_PRICE, SETTLEMENT_FEED_DECIMALS);
        TokenConfig memory config = tokenConfig[token];
        if (!config.configured) revert Unsupported();

        // Some stock tokens publish an oracle pause flag; a true value must block
        // pricing. Tokens without the method are tolerated.
        bool paused;
        try IStockToken(token).oraclePaused() returns (bool value) {
            paused = value;
        } catch {}
        if (paused) revert BadPrice();

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IPriceFeed(config.feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (answeredInRound < roundId || updatedAt == 0) revert BadPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) revert StalePrice();
        return (uint256(answer), IPriceFeed(config.feed).decimals());
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view override returns (uint256) {
        if (amountIn == 0) revert BadArguments();
        if (!isSupported(tokenIn) || !isSupported(tokenOut) || tokenIn == tokenOut) revert Unsupported();
        // Only single-hop settlement <-> stock routes are permitted.
        if (tokenIn != settlement && tokenOut != settlement) revert Unsupported();
        (uint256 priceIn, uint8 feedDecIn) = _price(tokenIn);
        (uint256 priceOut, uint8 feedDecOut) = _price(tokenOut);
        uint8 decIn = _decimals(tokenIn);
        uint8 decOut = _decimals(tokenOut);

        uint256 out = (amountIn * priceIn * (10 ** uint256(decOut)) * (10 ** uint256(feedDecOut)))
            / ((10 ** uint256(decIn)) * (10 ** uint256(feedDecIn)) * priceOut);
        return out;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        override
        returns (uint256 amountOut)
    {
        if (recipient == address(0)) revert BadArguments();
        if (!isSupported(tokenIn) || !isSupported(tokenOut) || tokenIn == tokenOut) revert Unsupported();
        if (tokenIn != settlement && tokenOut != settlement) revert Unsupported();

        // Only settlement <-> configured stock token routes are supported; use the
        // configured fee tier for whichever leg is the stock token.
        uint24 fee = tokenIn == settlement ? tokenConfig[tokenOut].fee : tokenConfig[tokenIn].fee;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(router, amountIn);

        IERC20 outToken = IERC20(tokenOut);
        uint256 before = outToken.balanceOf(recipient);

        ISwapRouter02(router).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Never leave a residual router allowance.
        IERC20(tokenIn).forceApprove(router, 0);

        // Trust the measured recipient balance delta, not the router's report.
        amountOut = outToken.balanceOf(recipient) - before;
        if (amountOut < minAmountOut) revert Slippage();
    }
}
