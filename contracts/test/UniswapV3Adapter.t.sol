// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {UniswapV3Adapter} from "../src/adapters/UniswapV3Adapter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockPausableToken} from "../src/mocks/MockPausableToken.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {SproutFactory} from "../src/SproutFactory.sol";
import {SproutVault} from "../src/SproutVault.sol";

contract UniswapV3AdapterTest is Test {
    MockERC20 settlement;
    MockERC20 stockA;
    MockERC20 stockB;
    MockERC20 other;
    MockPriceFeed feedA;
    MockPriceFeed feedB;
    MockSwapRouter router;
    UniswapV3Adapter adapter;

    address parent = address(0xA11CE);
    address beneficiary = address(0xB0B);

    function setUp() public {
        vm.warp(1_700_000_000);
        settlement = new MockERC20("USD", "USD", 6);
        stockA = new MockERC20("Stock A", "AAA", 18);
        stockB = new MockERC20("Stock B", "BBB", 18);
        other = new MockERC20("Other", "OTH", 18);
        feedA = new MockPriceFeed(8, 100e8, block.timestamp);
        feedB = new MockPriceFeed(8, 50e8, block.timestamp);

        router = new MockSwapRouter();
        address[] memory tokens = new address[](2);
        tokens[0] = address(stockA);
        tokens[1] = address(stockB);
        address[] memory feeds = new address[](2);
        feeds[0] = address(feedA);
        feeds[1] = address(feedB);
        uint24[] memory fees = new uint24[](2);
        fees[0] = 3000;
        fees[1] = 3000;
        adapter = new UniswapV3Adapter(address(router), address(settlement), tokens, feeds, fees, 1 hours);

        stockA.mint(address(router), 1_000_000e18);
        stockB.mint(address(router), 1_000_000e18);
        // 1 settlement = 0.01 AAA, 1 settlement = 0.02 BBB
        router.setRate(address(settlement), address(stockA), 0.01e18);
        router.setRate(address(settlement), address(stockB), 0.02e18);
        router.setRate(address(stockA), address(settlement), 100e18);
        settlement.mint(address(this), 1_000_000e6);
    }

    function testQuoteScalesSixAndEighteenDecimals() public view {
        // 1.0 settlement (6dp) buys 0.01 AAA (18dp)
        assertEq(adapter.quote(address(settlement), address(stockA), 1e6), 0.01e18);
        // reverse
        assertEq(adapter.quote(address(stockA), address(settlement), 0.01e18), 1e6);
        // 2.5 settlement buys 0.025 AAA
        assertEq(adapter.quote(address(settlement), address(stockA), 2_500_000), 0.025e18);
    }

    function testSwapTransfersAndClearsAllowance() public {
        IERC20(address(settlement)).approve(address(adapter), 1e6);
        uint256 out = adapter.swap(address(settlement), address(stockA), 1e6, 0.009e18, address(this));
        assertEq(out, 0.01e18);
        assertEq(stockA.balanceOf(address(this)), 0.01e18);
        assertEq(settlement.allowance(address(adapter), address(router)), 0);
    }

    function testUnsupportedPairsRevert() public {
        vm.expectRevert(UniswapV3Adapter.Unsupported.selector);
        adapter.quote(address(stockA), address(stockB), 1e18);
        vm.expectRevert(UniswapV3Adapter.Unsupported.selector);
        adapter.quote(address(other), address(stockA), 1e6);
    }

    function testStaleNonPositiveAndPausedFeedsRevert() public {
        feedA.setAnswerAt(100e8, block.timestamp - 2 days);
        vm.expectRevert(UniswapV3Adapter.StalePrice.selector);
        adapter.quote(address(settlement), address(stockA), 1e6);

        feedA.setAnswer(-1);
        vm.expectRevert(UniswapV3Adapter.BadPrice.selector);
        adapter.quote(address(settlement), address(stockA), 1e6);

        feedA.setPaused(true);
        vm.expectRevert("PAUSED");
        adapter.quote(address(settlement), address(stockA), 1e6);
    }

    function testFreshFeedButPausedTokenReverts() public {
        MockPausableToken pausable = new MockPausableToken("Pausable", "PAU", 18);
        MockPriceFeed feed = new MockPriceFeed(8, 100e8, block.timestamp);
        address[] memory tokens = new address[](1);
        tokens[0] = address(pausable);
        address[] memory feeds = new address[](1);
        feeds[0] = address(feed);
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;
        UniswapV3Adapter pausableAdapter =
            new UniswapV3Adapter(address(router), address(settlement), tokens, feeds, fees, 1 hours);

        // Feed is fresh; the token itself reports its oracle paused.
        pausable.setOraclePaused(true);
        vm.expectRevert(UniswapV3Adapter.BadPrice.selector);
        pausableAdapter.quote(address(settlement), address(pausable), 1e6);
    }

    function testMinimumAboveMarketReverts() public {
        // The adapter no longer pre-rejects against its own quote; the router's
        // amountOutMinimum does the enforcement when the market cannot satisfy it.
        IERC20(address(settlement)).approve(address(adapter), 1e6);
        vm.expectRevert("Too little received");
        adapter.swap(address(settlement), address(stockA), 1e6, 0.02e18, address(this));
    }

    function testHigherMinimumSatisfiedByFavorableMarket() public {
        // A favorable market fills above the oracle quote, so a minimum that is
        // higher than the oracle expectation is still valid and must not be
        // rejected by the adapter.
        router.setRate(address(settlement), address(stockA), 0.02e18);
        IERC20(address(settlement)).approve(address(adapter), 1e6);
        uint256 out = adapter.swap(address(settlement), address(stockA), 1e6, 0.015e18, address(this));
        assertEq(out, 0.02e18);
        assertEq(stockA.balanceOf(address(this)), 0.02e18);
    }

    function testFalseRouterReportRevertsOnMeasuredDelta() public {
        // Router reports a large output but sends almost nothing.
        router.setShortPay(true, 100);
        IERC20(address(settlement)).approve(address(adapter), 1e6);
        vm.expectRevert(UniswapV3Adapter.Slippage.selector);
        adapter.swap(address(settlement), address(stockA), 1e6, 0.009e18, address(this));
    }

    function testRouterSlippageReverts() public {
        // Router underfills versus the oracle quote, so exactInputSingle reverts.
        router.setRate(address(settlement), address(stockA), 0.001e18);
        IERC20(address(settlement)).approve(address(adapter), 1e6);
        vm.expectRevert("Too little received");
        adapter.swap(address(settlement), address(stockA), 1e6, 0.009e18, address(this));
    }

    function testVaultRejectsRouterThatUnderpaysWhileReportingHigh() public {
        MockERC20[] memory stocks = new MockERC20[](2);
        stocks[0] = stockA;
        stocks[1] = stockB;
        address[] memory assets = new address[](2);
        assets[0] = address(stockA);
        assets[1] = address(stockB);
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        uint16[] memory weights = new uint16[](2);
        weights[0] = 6000;
        weights[1] = 4000;

        SproutVault impl = new SproutVault();
        SproutFactory factory = new SproutFactory(address(impl), address(settlement), assets, venues);
        vm.prank(parent);
        SproutVault vault = SproutVault(
            factory.createSprout(beneficiary, address(settlement), assets, weights, uint64(block.timestamp + 365 days), venues)
        );

        settlement.mint(address(vault), 1_000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);

        uint256[] memory mins = new uint256[](2);
        mins[0] = (adapter.quote(address(settlement), address(stockA), 6e6) * 9900) / 10_000;
        mins[1] = (adapter.quote(address(settlement), address(stockB), 4e6) * 9900) / 10_000;
        vault.executeInvestment(address(adapter), mins);
        assertGt(stockA.balanceOf(address(vault)), 0);
        assertEq(settlement.allowance(address(vault), address(adapter)), 0);

        // Next period: router underpays while reporting a large output.
        router.setShortPay(true, 100);
        vm.warp(block.timestamp + 1 days + 1);
        feedA.setAnswer(100e8);
        feedB.setAnswer(50e8);
        // The adapter measures the recipient delta and reverts before the vault.
        vm.expectRevert(UniswapV3Adapter.Slippage.selector);
        vault.executeInvestment(address(adapter), mins);
        assertEq(settlement.allowance(address(vault), address(adapter)), 0);
    }

    function testStaleSecondLegRollsBackWholeBasketAndFreshOnlyStillBuys() public {
        address[] memory assets = new address[](2);
        assets[0] = address(stockA);
        assets[1] = address(stockB);
        address[] memory venues = new address[](1);
        venues[0] = address(adapter);
        uint16[] memory weights = new uint16[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        SproutVault impl = new SproutVault();
        SproutFactory factory = new SproutFactory(address(impl), address(settlement), assets, venues);
        vm.prank(parent);
        SproutVault mixed = SproutVault(factory.createSprout(beneficiary, address(settlement), assets, weights, uint64(block.timestamp + 365 days), venues));
        settlement.mint(address(mixed), 100e6);
        vm.prank(parent);
        mixed.scheduleInvestment(10e6, 1 days, 0);
        uint256[] memory mins = new uint256[](2);
        mins[0] = 0.0495e18;
        mins[1] = 0.099e18;
        feedB.setAnswerAt(50e8, block.timestamp - 2 days);
        uint64 dueBefore = mixed.nextExecution();
        vm.expectRevert(UniswapV3Adapter.StalePrice.selector);
        mixed.executeInvestment(address(adapter), mins);
        assertEq(settlement.balanceOf(address(mixed)), 100e6);
        assertEq(stockA.balanceOf(address(mixed)), 0);
        assertEq(stockB.balanceOf(address(mixed)), 0);
        assertEq(mixed.nextExecution(), dueBefore);
        assertEq(settlement.allowance(address(mixed), address(adapter)), 0);

        // The same factory/adapter can buy a healthy asset despite another stale feed.
        address[] memory freshAssets = new address[](1);
        freshAssets[0] = address(stockA);
        uint16[] memory freshWeights = new uint16[](1);
        freshWeights[0] = 10000;
        vm.prank(parent);
        SproutVault fresh = SproutVault(factory.createSprout(beneficiary, address(settlement), freshAssets, freshWeights, uint64(block.timestamp + 365 days), venues));
        settlement.mint(address(fresh), 100e6);
        vm.prank(parent);
        fresh.scheduleInvestment(10e6, 1 days, 0);
        uint256[] memory freshMin = new uint256[](1);
        freshMin[0] = 0.099e18;
        fresh.executeInvestment(address(adapter), freshMin);
        assertEq(stockA.balanceOf(address(fresh)), 0.1e18);
        assertEq(settlement.balanceOf(address(fresh)), 90e6);
    }
}
