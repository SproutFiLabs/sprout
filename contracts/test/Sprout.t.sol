// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockVenue} from "../src/mocks/MockVenue.sol";
import {SproutVault} from "../src/SproutVault.sol";
import {SproutFactory} from "../src/SproutFactory.sol";
import {ISproutVenue} from "../src/interfaces/ISproutVenue.sol";

/// @notice A hostile venue admitted nowhere by policy. It can quote a huge
///         output and report success while sending almost nothing.
contract MaliciousVenue is ISproutVenue {
    using SafeERC20 for IERC20;

    function quote(address, address, uint256 amountIn) external pure override returns (uint256) {
        return amountIn * 1_000;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256, address recipient)
        external
        override
        returns (uint256)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, 1);
        return amountIn * 1_000;
    }
}

contract SproutTest is Test {
    MockERC20 settlement;
    MockERC20 stockA;
    MockERC20 stockB;
    MockERC20 other;
    MockPriceFeed feedSettlement;
    MockPriceFeed feedA;
    MockPriceFeed feedB;
    MockVenue venue;
    SproutVault impl;
    SproutFactory factory;

    address parent = address(0xA11CE);
    address beneficiary = address(0xB0B);
    address gifter = address(0x6117);
    address stranger = address(0x5741);

    address[] assets;
    uint16[] weights;
    address[] venues;
    uint64 grad;

    bytes32 constant MILESTONE_1 = keccak256("milestone-1");
    bytes32 constant MILESTONE_2 = keccak256("milestone-2");
    bytes32 constant GIFT_REF = keccak256("birthday-2026");

    function setUp() public {
        vm.warp(1_700_000_000);
        settlement = new MockERC20("USD", "USD", 6);
        stockA = new MockERC20("Stock A", "AAA", 18);
        stockB = new MockERC20("Stock B", "BBB", 18);
        other = new MockERC20("Other", "OTH", 18);

        feedSettlement = new MockPriceFeed(8, 1e8, block.timestamp);
        feedA = new MockPriceFeed(8, 100e8, block.timestamp);
        feedB = new MockPriceFeed(8, 50e8, block.timestamp);

        venue = new MockVenue();
        venue.setFeed(address(settlement), feedSettlement);
        venue.setFeed(address(stockA), feedA);
        venue.setFeed(address(stockB), feedB);
        stockA.mint(address(venue), 1_000_000e18);
        stockB.mint(address(venue), 1_000_000e18);

        impl = new SproutVault();
        addressesSetup();
        factory = new SproutFactory(address(impl), address(settlement), assets, venues);

        grad = uint64(block.timestamp + 365 days);
    }

    function addressesSetup() internal {
        assets.push(address(stockA));
        assets.push(address(stockB));
        weights.push(6000);
        weights.push(4000);
        venues.push(address(venue));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _create() internal returns (SproutVault vault) {
        vm.prank(parent);
        vault = SproutVault(
            factory.createSprout(beneficiary, address(settlement), assets, weights, grad, venues)
        );
    }

    function _fund(SproutVault vault, address token, uint256 amount) internal {
        MockERC20(token).mint(address(this), amount);
        IERC20(token).approve(address(vault), amount);
        vault.fund(token, amount);
    }

    function _mins(SproutVault vault, uint256 spend) internal view returns (uint256[] memory mins) {
        (, uint16[] memory w) = vault.allocation();
        address[] memory a = vault.assets();
        mins = new uint256[](a.length);
        for (uint256 i = 0; i < a.length; i++) {
            uint256 amountIn = (spend * w[i]) / 10_000;
            if (amountIn > 0) {
                mins[i] = venue.quote(address(settlement), a[i], amountIn);
            }
        }
    }

    // ------------------------------------------------------------------
    // Factory / initialization / admission
    // ------------------------------------------------------------------

    function testFactoryPublishesImmutableAdmission() public {
        assertTrue(factory.isAdmittedAsset(address(stockA)));
        assertTrue(factory.isAdmittedVenue(address(venue)));
        assertFalse(factory.isAdmittedAsset(address(other)));
        assertEq(factory.settlementToken(), address(settlement));
    }

    function testFactoryCreatesVault() public {
        SproutVault vault = _create();
        assertEq(vault.parent(), parent);
        assertEq(vault.beneficiary(), beneficiary);
        assertEq(vault.settlementToken(), address(settlement));
        assertEq(vault.factory(), address(factory));
        assertEq(vault.graduationTimestamp(), grad);
        assertEq(factory.totalSprouts(), 1);
        assertEq(factory.sproutsOfLength(parent), 1);
        assertEq(vault.weights()[0], 6000);
    }

    function testFactoryRejectsUnadmittedAssetAtCreation() public {
        address[] memory badAssets = new address[](2);
        badAssets[0] = address(stockA);
        badAssets[1] = address(other);
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        vm.prank(parent);
        vm.expectRevert(SproutFactory.UnsupportedToken.selector);
        factory.createSprout(beneficiary, address(settlement), badAssets, w, grad, venues);
    }

    function testFactoryRejectsUnadmittedVenueAtCreation() public {
        address[] memory badVenues = new address[](1);
        badVenues[0] = address(0xBAD);
        vm.prank(parent);
        vm.expectRevert(SproutFactory.UnsupportedVenue.selector);
        factory.createSprout(beneficiary, address(settlement), assets, weights, grad, badVenues);
    }

    function testFactoryRejectsWrongSettlement() public {
        vm.prank(parent);
        vm.expectRevert(SproutFactory.UnsupportedToken.selector);
        factory.createSprout(beneficiary, address(other), assets, weights, grad, venues);
    }

    function testParentCannotAdmitNewTokenLater() public {
        SproutVault vault = _create();
        address[] memory next = new address[](2);
        next[0] = address(stockA);
        next[1] = address(other);
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        vm.prank(parent);
        vm.expectRevert(SproutVault.UnsupportedToken.selector);
        vault.updateAllocation(next, w);
    }

    function testParentCannotAdmitNewVenueLater() public {
        SproutVault vault = _create();
        vm.prank(parent);
        vm.expectRevert(SproutVault.UnsupportedVenue.selector);
        vault.setVenueAllowed(address(0xBAD), true);
    }

    function testParentCanToggleAdmittedVenueAndEditAllocation() public {
        SproutVault vault = _create();
        vm.startPrank(parent);
        vault.setVenueAllowed(address(venue), false);
        assertFalse(vault.venueAllowed(address(venue)));
        vault.setVenueAllowed(address(venue), true);
        assertTrue(vault.venueAllowed(address(venue)));

        // Re-order the same admitted assets with new weights.
        address[] memory next = new address[](2);
        next[0] = address(stockB);
        next[1] = address(stockA);
        uint16[] memory w = new uint16[](2);
        w[0] = 2500;
        w[1] = 7500;
        vault.updateAllocation(next, w);
        vm.stopPrank();
        assertEq(vault.assets()[0], address(stockB));
        assertEq(vault.weights()[1], 7500);
    }

    function testInitializeCannotRunTwice() public {
        SproutVault vault = _create();
        vm.expectRevert();
        vault.initialize(
            address(factory), parent, beneficiary, address(settlement), assets, weights, grad, venues
        );
    }

    function testInitializeRejectsNonFactoryCaller() public {
        // A clone that has not been initialized by its factory rejects callers.
        address clone = Clones.clone(address(impl));
        vm.expectRevert(SproutVault.BadArguments.selector);
        SproutVault(clone).initialize(address(factory), parent, beneficiary, address(settlement), assets, weights, grad, venues);
    }

    // ------------------------------------------------------------------
    // Extraction / redirect
    // ------------------------------------------------------------------

    function testParentCannotWithdrawBeforeGraduation() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.prank(parent);
        vm.expectRevert(SproutVault.NotGraduated.selector);
        vault.withdraw(address(settlement), 1e6, parent);
    }

    function testParentCannotWithdrawOrRedirectAfterGraduation() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.warp(grad + 1);
        vm.startPrank(parent);
        vm.expectRevert(SproutVault.NotBeneficiary.selector);
        vault.withdraw(address(settlement), 100e6, parent);
        vm.expectRevert(SproutVault.NotBeneficiary.selector);
        vault.withdraw(address(settlement), 100e6, beneficiary);
        vm.stopPrank();
        assertEq(vault.beneficiary(), beneficiary);
        assertEq(settlement.balanceOf(address(vault)), 100e6);
    }

    function testBeneficiaryWithdrawsAfterGraduation() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.warp(grad + 1);
        vm.prank(beneficiary);
        vault.withdraw(address(settlement), 100e6, beneficiary);
        assertEq(settlement.balanceOf(beneficiary), 100e6);
    }

    function testGraduationBoundaryIsExact() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);

        vm.warp(grad - 1);
        vm.prank(parent);
        vault.updateAllocation(assets, weights);
        vm.prank(beneficiary);
        vm.expectRevert(SproutVault.NotGraduated.selector);
        vault.withdraw(address(settlement), 1e6, beneficiary);

        vm.warp(grad);
        vm.prank(parent);
        vm.expectRevert(SproutVault.Graduated.selector);
        vault.updateAllocation(assets, weights);
        vm.prank(parent);
        vm.expectRevert(SproutVault.Graduated.selector);
        vault.scheduleInvestment(1e6, 1 days, 0);
        vm.prank(beneficiary);
        vault.withdraw(address(settlement), 100e6, beneficiary);
        assertEq(settlement.balanceOf(beneficiary), 100e6);
    }

    function testStrangerCannotCallPrivilegedFunctions() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.startPrank(stranger);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.updateAllocation(assets, weights);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.scheduleInvestment(1e6, 1 days, 0);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.cancelInvestment();
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.setVenueAllowed(address(venue), false);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.setMaxSlippage(500);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.createMilestone(MILESTONE_1, address(settlement), 1e6, 0);
        vm.expectRevert(SproutVault.NotParent.selector);
        vault.releaseMilestone(MILESTONE_1);
        vm.expectRevert(SproutVault.NotBeneficiary.selector);
        vault.claimAllowance(address(settlement), 1e6);
        vm.expectRevert(SproutVault.NotGraduated.selector);
        vault.withdraw(address(settlement), 1e6, stranger);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Allowance milestones
    // ------------------------------------------------------------------

    function testMilestoneReleaseAndClaim() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);

        vm.prank(parent);
        vault.createMilestone(MILESTONE_1, address(settlement), 10e6, 0);
        assertEq(vault.totalEarmarked(address(settlement)), 10e6);

        vm.prank(parent);
        vault.releaseMilestone(MILESTONE_1);
        assertEq(vault.allowanceBucket(address(settlement)), 10e6);
        vm.prank(parent);
        vm.expectRevert(SproutVault.AlreadyDone.selector);
        vault.releaseMilestone(MILESTONE_1);

        vm.prank(beneficiary);
        vault.claimAllowance(address(settlement), 4e6);
        assertEq(vault.allowanceBucket(address(settlement)), 6e6);
        vm.prank(beneficiary);
        vm.expectRevert(SproutVault.ExceedsAllowance.selector);
        vault.claimAllowance(address(settlement), 7e6);
        vm.prank(beneficiary);
        vault.claimAllowance(address(settlement), 6e6);
        vm.prank(beneficiary);
        vm.expectRevert(SproutVault.NothingClaimable.selector);
        vault.claimAllowance(address(settlement), 1);
    }

    function testMilestoneCannotBeReleasedTwiceOrOvercommitted() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.startPrank(parent);
        vault.createMilestone(MILESTONE_1, address(settlement), 60e6, 0);
        vm.expectRevert(SproutVault.Overcommitted.selector);
        vault.createMilestone(MILESTONE_2, address(settlement), 50e6, 0);
        vm.expectRevert(SproutVault.AlreadyDone.selector);
        vault.createMilestone(MILESTONE_1, address(settlement), 1e6, 0);
        vm.stopPrank();
    }

    function testMilestoneUnlockGate() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        uint64 unlock = uint64(block.timestamp + 1 days);
        vm.startPrank(parent);
        vault.createMilestone(MILESTONE_1, address(settlement), 10e6, unlock);
        vm.expectRevert(SproutVault.NotDue.selector);
        vault.releaseMilestone(MILESTONE_1);
        vm.warp(unlock);
        vault.releaseMilestone(MILESTONE_1);
        vm.stopPrank();
        assertEq(vault.allowanceBucket(address(settlement)), 10e6);
    }

    function testMilestoneCancelReleasesEarmark() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.startPrank(parent);
        vault.createMilestone(MILESTONE_1, address(settlement), 90e6, 0);
        vault.cancelMilestone(MILESTONE_1);
        assertEq(vault.totalEarmarked(address(settlement)), 0);
        vault.createMilestone(MILESTONE_2, address(settlement), 90e6, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Scheduling / execution / custody
    // ------------------------------------------------------------------

    function testExecutionNotDueThenOnePerPeriod() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        uint64 first = uint64(block.timestamp + 1 hours);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, first);

        uint256[] memory mins = _mins(vault, 10e6);
        vm.expectRevert(SproutVault.NotDue.selector);
        vault.executeInvestment(address(venue), mins);

        vm.warp(first);
        vault.executeInvestment(address(venue), mins);
        (, , , uint64 nextExec,) = vault.schedule();
        assertEq(nextExec, first + 1 days);
        vm.expectRevert(SproutVault.NotDue.selector);
        vault.executeInvestment(address(venue), mins);
    }

    function testCatchUpExecutesAtMostOneInstallment() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, uint64(block.timestamp - 3 days));
        uint256[] memory mins = _mins(vault, 10e6);
        vault.executeInvestment(address(venue), mins);
        (, , , uint64 nextExec,) = vault.schedule();
        assertEq(nextExec, uint64(block.timestamp) + 1 days);
        assertEq(settlement.balanceOf(address(vault)), 990e6);
    }

    function testValidExecutionBuysAllocationAndClearsApproval() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        uint256[] memory mins = new uint256[](2);
        mins[0] = venue.quote(address(settlement), address(stockA), 6e6);
        mins[1] = venue.quote(address(settlement), address(stockB), 4e6);
        vault.executeInvestment(address(venue), mins);
        assertEq(stockA.balanceOf(address(vault)), mins[0]);
        assertEq(stockB.balanceOf(address(vault)), mins[1]);
        assertEq(settlement.balanceOf(address(vault)), 990e6);
        // Residual approval must be cleared.
        assertEq(settlement.allowance(address(vault), address(venue)), 0);
    }

    function testMaliciousVenueCannotStealFundsViaFalseReport() public {
        MaliciousVenue malicious = new MaliciousVenue();
        stockA.mint(address(malicious), 1e18);
        // The factory will not admit it, but even if a venue were allowed the vault
        // measures the real balance delta and reverts on shortfall.
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);

        uint256[] memory mins = new uint256[](2);
        mins[0] = 10e6 * 1_000;
        mins[1] = 10e6 * 1_000;
        vm.expectRevert(SproutVault.VenueNotAllowed.selector);
        vault.executeInvestment(address(malicious), mins);
    }

    function testAdmittedVenueFalseOutputStillCannotSteal() public {
        MaliciousVenue malicious = new MaliciousVenue();
        stockA.mint(address(malicious), 1e18);
        address[] memory a = new address[](1);
        a[0] = address(stockA);
        address[] memory v = new address[](1);
        v[0] = address(malicious);
        SproutFactory f2 = new SproutFactory(address(impl), address(settlement), a, v);
        uint16[] memory w = new uint16[](1);
        w[0] = 10000;
        vm.prank(parent);
        SproutVault vault = SproutVault(f2.createSprout(beneficiary, address(settlement), a, w, grad, v));
        _fund(vault, address(settlement), 100e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        uint256[] memory mins = new uint256[](1);
        mins[0] = 10e6 * 1_000;
        vm.expectRevert(SproutVault.Shortfall.selector);
        vault.executeInvestment(address(malicious), mins);
        assertEq(settlement.balanceOf(address(vault)), 100e6);
        assertEq(settlement.allowance(address(vault), address(malicious)), 0);
    }

    function testUnadmittedVenueRejectedEvenWhenToggledOff() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        vm.prank(parent);
        vault.setVenueAllowed(address(venue), false);
        uint256[] memory mins = _mins(vault, 10e6);
        vm.expectRevert(SproutVault.VenueNotAllowed.selector);
        vault.executeInvestment(address(venue), mins);
    }

    function testTooLowMinOutRevertsAndPreservesFunds() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        uint256[] memory mins = new uint256[](2);
        vm.expectRevert(SproutVault.BadArguments.selector);
        vault.executeInvestment(address(venue), mins);
        assertEq(settlement.balanceOf(address(vault)), 1000e6);
    }

    function testStaleOracleRevertsAtomically() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        feedA.setAnswerAt(100e8, block.timestamp - 2 days);
        uint256[] memory mins = new uint256[](2);
        vm.expectRevert("STALE_PRICE");
        vault.executeInvestment(address(venue), mins);
        assertEq(settlement.balanceOf(address(vault)), 1000e6);
    }

    function testPausedOracleRevertsAtomically() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 1000e6);
        vm.prank(parent);
        vault.scheduleInvestment(10e6, 1 days, 0);
        feedA.setPaused(true);
        uint256[] memory mins = new uint256[](2);
        vm.expectRevert("PAUSED");
        vault.executeInvestment(address(venue), mins);
        assertEq(settlement.balanceOf(address(vault)), 1000e6);
    }

    function testExecutionCannotSpendEarmarkedFunds() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        vm.startPrank(parent);
        vault.createMilestone(MILESTONE_1, address(settlement), 95e6, 0);
        vault.scheduleInvestment(10e6, 1 days, 0);
        vm.stopPrank();
        uint256[] memory mins = _mins(vault, 10e6);
        vm.expectRevert(SproutVault.Overcommitted.selector);
        vault.executeInvestment(address(venue), mins);
    }

    function testSlippageCapIsBounded() public {
        SproutVault vault = _create();
        vm.prank(parent);
        vm.expectRevert(SproutVault.BadArguments.selector);
        vault.setMaxSlippage(1_001);
    }

    // ------------------------------------------------------------------
    // Integer / dust conservation
    // ------------------------------------------------------------------

    function testRoundingDustIsCarriedForward() public {
        SproutVault vault = _create();
        _fund(vault, address(settlement), 100e6);
        uint256 amount = 5_000_123;
        vm.prank(parent);
        vault.scheduleInvestment(amount, 1 days, 0);
        uint256 shareA = (amount * 6000) / 10_000;
        uint256 shareB = (amount * 4000) / 10_000;
        uint256[] memory mins = _mins(vault, amount);
        vault.executeInvestment(address(venue), mins);
        assertEq(settlement.balanceOf(address(vault)), 100e6 - (shareA + shareB));
        assertEq(stockA.balanceOf(address(vault)), mins[0]);
        assertEq(stockB.balanceOf(address(vault)), mins[1]);
    }

    function testFuzzAllocationNeverCreatesValue(uint96 raw) public {
        uint256 amount = uint256(raw) % 1_000_000_000 + 3;
        uint16 wA = uint16(uint256(keccak256(abi.encode(raw))) % 9999 + 1);
        uint16 wB = uint16(10_000 - wA);
        SproutVault vault = _create();
        _fund(vault, address(settlement), amount);
        address[] memory a = new address[](2);
        a[0] = address(stockA);
        a[1] = address(stockB);
        uint16[] memory w = new uint16[](2);
        w[0] = wA;
        w[1] = wB;
        vm.startPrank(parent);
        vault.updateAllocation(a, w);
        vault.scheduleInvestment(amount, 1 days, 0);
        vm.stopPrank();
        uint256[] memory mins = _mins(vault, amount);
        vault.executeInvestment(address(venue), mins);
        uint256 spent = (amount * wA) / 10_000 + (amount * wB) / 10_000;
        assertLe(spent, amount);
        assertEq(settlement.balanceOf(address(vault)), amount - spent);
    }

    // ------------------------------------------------------------------
    // Gifts
    // ------------------------------------------------------------------

    function testGiftIsReusable() public {
        SproutVault vault = _create();
        settlement.mint(gifter, 20e6);
        vm.startPrank(gifter);
        IERC20(address(settlement)).approve(address(vault), 20e6);
        vault.payGift(address(settlement), 5e6, GIFT_REF);
        vault.payGift(address(settlement), 5e6, GIFT_REF);
        vm.stopPrank();
        assertEq(settlement.balanceOf(address(vault)), 10e6);
    }

    function testGiftRejectsUnsupportedAsset() public {
        SproutVault vault = _create();
        other.mint(gifter, 1e18);
        vm.startPrank(gifter);
        IERC20(address(other)).approve(address(vault), 1e18);
        vm.expectRevert(SproutVault.UnsupportedToken.selector);
        vault.payGift(address(other), 1e18, GIFT_REF);
        vm.stopPrank();
    }

    function testGiftDoesNotGrantWithdrawal() public {
        SproutVault vault = _create();
        settlement.mint(gifter, 5e6);
        vm.startPrank(gifter);
        IERC20(address(settlement)).approve(address(vault), 5e6);
        vault.payGift(address(settlement), 5e6, GIFT_REF);
        vm.expectRevert(SproutVault.NotBeneficiary.selector);
        vault.claimAllowance(address(settlement), 1);
        vm.expectRevert(SproutVault.NotGraduated.selector);
        vault.withdraw(address(settlement), 1, gifter);
        vm.stopPrank();
    }
}
