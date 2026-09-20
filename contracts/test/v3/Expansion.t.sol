// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {SproutV3Vault} from "../../src/v3/SproutV3Vault.sol";
import {MatchVault} from "../../src/v3/MatchVault.sol";
import {RoundupModule} from "../../src/v3/RoundupModule.sol";
import {TreasuryPolicy} from "../../src/v3/TreasuryPolicy.sol";
import {EventBook} from "../../src/v3/EventBook.sol";
import {LocalTreasury} from "./LocalTreasury.sol";
import {SproutFactory} from "../../src/SproutFactory.sol";
import {SproutVault} from "../../src/SproutVault.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockVenue} from "../../src/mocks/MockVenue.sol";
import {MockPriceFeed} from "../../src/mocks/MockPriceFeed.sol";

contract ExpansionTest is Test {
    MockERC20 cash;
    MockERC20 stock;
    MatchVault matches;
    RoundupModule rounds;
    TreasuryPolicy policy;
    LocalTreasury treasury;
    SproutV3Vault vault;
    MockVenue venue;
    MockPriceFeed cashFeed;
    MockPriceFeed stockFeed;
    address parent = address(0xA11CE);
    address child = address(0xB0B);
    address sponsor = address(0x6117);
    address successor = address(0x1234);
    address guardian = address(0x5678);
    address executor = address(0xABCD);
    uint64 graduation;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_780_000_000);
        cash = new MockERC20("USD", "USD", 6);
        stock = new MockERC20("Stock", "AAA", 18);
        matches = new MatchVault();
        rounds = new RoundupModule();
        policy = new TreasuryPolicy(address(this), 1 days);
        treasury = new LocalTreasury(cash);
        SproutV3Vault impl = new SproutV3Vault(address(matches), address(treasury), address(policy));
        venue = new MockVenue();
        cashFeed = new MockPriceFeed(8, 1e8, block.timestamp);
        stockFeed = new MockPriceFeed(8, 100e8, block.timestamp);
        venue.setFeed(address(cash), cashFeed);
        venue.setFeed(address(stock), stockFeed);
        stock.mint(address(venue), 1000e18);
        address[] memory assets = new address[](1);
        assets[0] = address(stock);
        address[] memory venues = new address[](1);
        venues[0] = address(venue);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10000;
        SproutFactory factory = new SproutFactory(address(impl), address(cash), assets, venues);
        graduation = uint64(block.timestamp + 365 days);
        vm.prank(parent);
        vault = SproutV3Vault(factory.createSprout(child, address(cash), assets, weights, graduation, venues));
        policy.setPermitted(address(vault), true);
        policy.publishHeartbeat();
        cash.mint(parent, 10000e6);
        cash.mint(sponsor, 10000e6);
        vm.prank(parent);
        cash.approve(address(vault), type(uint256).max);
        vm.prank(parent);
        cash.approve(address(rounds), type(uint256).max);
        vm.prank(sponsor);
        cash.approve(address(matches), type(uint256).max);
    }

    function fund(uint256 n) internal {
        vm.prank(parent);
        vault.fund(address(cash), n);
    }

    function commit() internal returns (uint256) {
        vm.prank(sponsor);
        return matches.commit(address(vault), 300e6, 50e6, 6);
    }

    function plan(uint64 early) internal {
        vm.prank(parent);
        vault.writePlan(successor, guardian, 7 days, 2 days, early, keccak256("care"), 50e6, 30 days);
    }

    function activate() internal {
        vm.warp(block.timestamp + 7 days);
        vm.prank(successor);
        vault.armContinuity();
        vm.warp(block.timestamp + 2 days);
        uint256 epoch = vault.planEpoch();
        vm.prank(successor);
        vault.activateContinuity(epoch);
    }

    function park(uint256 n) internal {
        vm.prank(parent);
        vault.setCashEnabled(true);
        vault.parkCash(n, treasury.previewDeposit(n));
    }

    function invest(uint256 n) internal {
        cashFeed.setAnswer(1e8);
        stockFeed.setAnswer(100e8);
        uint256[] memory min = new uint256[](1);
        min[0] = venue.quote(address(cash), address(stock), n);
        vault.executeInvestment(address(venue), min);
    }

    function testMatchCapAndRefund() public {
        uint256 id = commit();
        fund(30e6);
        assertEq(cash.balanceOf(address(vault)), 60e6);
        fund(30e6);
        assertEq(cash.balanceOf(address(vault)), 110e6);
        uint256 before = cash.balanceOf(sponsor);
        vm.prank(sponsor);
        matches.cancel(id);
        assertEq(cash.balanceOf(sponsor) - before, 250e6);
        fund(10e6);
        assertEq(cash.balanceOf(address(vault)), 120e6);
    }

    function testMatchResetsAtPeriodAndExpires() public {
        commit();
        fund(50e6);
        vm.warp(block.timestamp + 30 days);
        fund(50e6);
        assertEq(cash.balanceOf(address(vault)), 200e6);
        vm.warp(block.timestamp + 180 days);
        fund(50e6);
        assertEq(cash.balanceOf(address(vault)), 250e6);
    }

    function testMatchDoesNotRecurseOrMatchGifter() public {
        commit();
        vm.startPrank(sponsor);
        cash.approve(address(vault), 25e6);
        vault.fund(address(cash), 25e6);
        vm.stopPrank();
        assertEq(cash.balanceOf(address(vault)), 25e6);
        assertEq(vault.contributionCount(), 0);
        fund(25e6);
        assertEq(vault.contributionCount(), 1);
        assertEq(cash.balanceOf(address(vault)), 75e6);
    }

    function testUnauthorizedCannotCancelSponsor() public {
        uint256 id = commit();
        vm.prank(parent);
        vm.expectRevert();
        matches.cancel(id);
    }

    function testContributionReplayRejected() public {
        commit();
        fund(1e6);
        vm.prank(address(vault));
        vm.expectRevert();
        matches.onContribution(parent, 50e6, 1);
    }

    function testReplacedSlotStillRefundable() public {
        uint256 id = commit();
        vm.warp(block.timestamp + 181 days);
        commit();
        vm.prank(sponsor);
        matches.cancel(id);
    }

    function testFuzzMatchNeverExceedsBudget(uint96 value) public {
        commit();
        uint256 n = bound(uint256(value), 1, 9999e6);
        fund(n);
        assertLe(cash.balanceOf(address(vault)) - n, 50e6);
    }

    function link() internal returns (bytes32 id) {
        vm.prank(parent);
        id = rounds.link(address(vault), executor, 25e6, uint64(block.timestamp + 180 days));
    }

    function testWeeklyPullCapAndNoDoublePull() public {
        bytes32 id = link();
        vm.prank(executor);
        vm.expectRevert();
        rounds.sweep(id, 1e6, keccak256("ledger"));
        vm.warp(block.timestamp + 7 days);
        vm.prank(executor);
        vm.expectRevert();
        rounds.sweep(id, 26e6, keccak256("ledger"));
        vm.prank(executor);
        rounds.sweep(id, 25e6, keccak256("ledger"));
        assertEq(cash.balanceOf(address(vault)), 25e6);
        vm.prank(executor);
        vm.expectRevert();
        rounds.sweep(id, 1e6, keccak256("ledger2"));
    }

    function testUnlinkStopsPull() public {
        bytes32 id = link();
        vm.warp(block.timestamp + 8 days);
        vm.prank(parent);
        rounds.unlink(id);
        vm.prank(executor);
        vm.expectRevert();
        rounds.sweep(id, 1e6, keccak256("ledger"));
    }

    function testRelinkCannotResetCooldown() public {
        bytes32 id = link();
        vm.warp(block.timestamp + 7 days);
        vm.prank(executor);
        rounds.sweep(id, 1e6, keccak256("ledger"));
        link();
        vm.prank(executor);
        vm.expectRevert();
        rounds.sweep(id, 1e6, keccak256("again"));
    }

    function testOnlyExecutorAndParentMayAct() public {
        vm.prank(sponsor);
        vm.expectRevert();
        rounds.link(address(vault), sponsor, 25e6, uint64(block.timestamp + 30 days));
        bytes32 id = link();
        vm.warp(block.timestamp + 8 days);
        vm.prank(sponsor);
        vm.expectRevert();
        rounds.sweep(id, 1e6, keccak256("ledger"));
    }

    function testTreasuryYieldAndExactRedemption() public {
        fund(100e6);
        park(100e6);
        cash.mint(address(treasury), 10e6);
        assertGe(treasury.convertToAssets(treasury.balanceOf(address(vault))), 109e6);
        vm.prank(parent);
        vault.unparkCash(50e6);
        assertEq(cash.balanceOf(address(vault)), 50e6);
        assertEq(cash.allowance(address(vault), address(treasury)), 0);
    }

    function testStalePolicyStopsParkingButAllowsRedemption() public {
        fund(200e6);
        park(100e6);
        vm.warp(block.timestamp + 2 days);
        uint256 quote = treasury.previewDeposit(50e6);
        vm.expectRevert();
        vault.parkCash(50e6, quote);
        vm.prank(parent);
        vault.unparkCash(25e6);
        assertEq(cash.balanceOf(address(vault)), 125e6);
    }

    function testEligibilityAndOnlyOwnerPolicy() public {
        policy.setPermitted(address(vault), false);
        vm.prank(parent);
        vm.expectRevert();
        vault.setCashEnabled(true);
        vm.prank(parent);
        vm.expectRevert();
        policy.publishHeartbeat();
    }

    function testStrangerCannotRedeemCash() public {
        fund(100e6);
        park(100e6);
        vm.prank(sponsor);
        vm.expectRevert();
        vault.unparkCash(50e6);
    }

    function testReserveExcludedFromParkingAndMilestones() public {
        plan(0);
        vm.prank(parent);
        vault.fundReserve(100e6);
        assertEq(vault.availableSettlement(), 0);
        vm.prank(parent);
        vault.setCashEnabled(true);
        vm.expectRevert();
        vault.parkCash(1e6, 1e6);
        vm.prank(parent);
        vm.expectRevert();
        vault.createMilestone(keccak256("m"), address(cash), 1e6, uint64(block.timestamp + 1 days));
    }

    function testReserveCannotBeRefundedDuringClaim() public {
        plan(0);
        vm.prank(parent);
        vault.fundReserve(100e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(successor);
        vault.armContinuity();
        vm.prank(parent);
        vm.expectRevert();
        vault.refundReserve(1e6);
    }

    function testGraceWindowAndParentCancel() public {
        plan(0);
        vm.prank(successor);
        vm.expectRevert();
        vault.armContinuity();
        vm.warp(block.timestamp + 7 days);
        vm.prank(successor);
        vault.armContinuity();
        uint256 epoch = vault.planEpoch();
        vm.prank(successor);
        vm.expectRevert();
        vault.activateContinuity(epoch);
        vm.prank(parent);
        vault.checkIn();
        vm.warp(block.timestamp + 2 days);
        vm.prank(successor);
        vm.expectRevert();
        vault.activateContinuity(epoch);
    }

    function testCoGuardianCancelsAndRevocationInvalidatesEpoch() public {
        plan(0);
        vm.warp(block.timestamp + 7 days);
        vm.prank(successor);
        vault.armContinuity();
        vm.prank(guardian);
        vault.cancelClaim();
        assertEq(vault.claimAt(), 0);
        uint256 epoch = vault.planEpoch();
        vm.prank(parent);
        vault.revokePlan();
        vm.prank(successor);
        vm.expectRevert();
        vault.activateContinuity(epoch);
    }

    function testSuccessorCannotWithdrawSavingsOrReplacePlan() public {
        plan(0);
        fund(100e6);
        activate();
        vm.prank(successor);
        vm.expectRevert();
        vault.withdraw(address(cash), 10e6, successor);
        vm.prank(successor);
        vm.expectRevert();
        vault.writePlan(sponsor, address(0), 7 days, 2 days, 0, keccak256("evil"), 1e6, 7 days);
        vm.prank(successor);
        vault.scheduleInvestment(25e6, 30 days, uint64(block.timestamp));
    }

    function testReserveRunsScheduledInvestmentOncePerPeriod() public {
        plan(0);
        vm.prank(parent);
        vault.fundReserve(100e6);
        vm.prank(parent);
        vault.scheduleInvestment(50e6, 7 days, uint64(block.timestamp));
        activate();
        invest(50e6);
        assertEq(vault.continuityReserve(), 50e6);
        assertEq(stock.balanceOf(address(vault)), 0.5e18);
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert();
        vault.executeInvestment(address(venue), new uint256[](1));
        assertEq(vault.continuityReserve(), 50e6);
    }

    function testInvestmentUnparksCashAutomatically() public {
        fund(100e6);
        park(100e6);
        vm.prank(parent);
        vault.scheduleInvestment(50e6, 7 days, uint64(block.timestamp));
        invest(50e6);
        assertEq(stock.balanceOf(address(vault)), 0.5e18);
        assertEq(cash.balanceOf(address(vault)), 0);
    }

    function testEarlyGraduationCannotBeUndone() public {
        uint64 early = uint64(block.timestamp + 12 days);
        plan(early);
        fund(100e6);
        activate();
        vm.warp(early);
        assertTrue(vault.graduated());
        vm.prank(parent);
        vm.expectRevert();
        vault.checkIn();
        vm.prank(guardian);
        vm.expectRevert();
        vault.cancelClaim();
        vm.prank(parent);
        vm.expectRevert();
        vault.revokePlan();
        vm.prank(child);
        vault.withdraw(address(cash), 100e6, child);
        assertEq(cash.balanceOf(child), 100e6);
    }

    function testEventBookParentOnly() public {
        EventBook book = new EventBook();
        bytes32 id = keccak256("birthday");
        vm.prank(sponsor);
        vm.expectRevert();
        book.create(id, address(vault), keccak256("details"), uint64(block.timestamp + 10 days));
        vm.prank(parent);
        book.create(id, address(vault), keccak256("details"), uint64(block.timestamp + 10 days));
        vm.prank(sponsor);
        vm.expectRevert();
        book.close(id);
        vm.prank(parent);
        book.close(id);
    }
}
