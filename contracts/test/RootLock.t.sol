// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {SproutRootLock} from "../src/SproutRootLock.sol";

/// @notice Burns `feeBps` of every transfer, so the receiver gets less than was sent.
contract FeeToken is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("Fee", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice A hostile token that tries to re-enter the lock during a transfer.
contract ReentrantToken is ERC20 {
    SproutRootLock public target;
    bool public attackWithdraw;
    uint256 public attackId;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(SproutRootLock target_, bool withdraw_, uint256 id_) external {
        target = target_;
        attackWithdraw = withdraw_;
        attackId = id_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (address(target) != address(0)) {
            SproutRootLock t = target;
            target = SproutRootLock(address(0));
            // Must revert with the guard's error; bubble it up so the test sees it.
            if (attackWithdraw) t.withdraw(attackId);
            else t.lock(1, 30);
        }
    }
}

contract RootLockTest is Test {
    MockERC20 sprout;
    SproutRootLock roots;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    uint256 constant E18 = 1e18;

    event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 lockDays, uint256 unlockAt);
    event Withdrawn(uint256 indexed lockId, address indexed owner, uint256 amount);

    function setUp() public {
        vm.warp(1_760_000_000);
        sprout = new MockERC20("Sprout", "SPROUT", 18);
        roots = new SproutRootLock(IERC20(address(sprout)));
        sprout.mint(alice, 50_000_000 * E18);
        sprout.mint(bob, 10_000_000 * E18);
        vm.prank(alice);
        sprout.approve(address(roots), type(uint256).max);
        vm.prank(bob);
        sprout.approve(address(roots), type(uint256).max);
    }

    function _lock(address who, uint256 amount, uint256 days_) internal returns (uint256 id) {
        vm.prank(who);
        id = roots.lock(amount, days_);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_setsTokenAndRejectsZero() public {
        assertEq(address(roots.token()), address(sprout));
        assertEq(roots.totalLocked(), 0);
        assertEq(roots.lockCount(), 0);
        vm.expectRevert(SproutRootLock.ZeroAddress.selector);
        new SproutRootLock(IERC20(address(0)));
    }

    // ------------------------------------------------------------------ lock

    function test_lock_recordsEverything() public {
        uint256 amount = 2_000_000 * E18;
        uint256 unlockAt = block.timestamp + 90 days;
        vm.expectEmit(true, true, false, true, address(roots));
        emit Locked(1, alice, amount, 90, unlockAt);
        uint256 id = _lock(alice, amount, 90);

        assertEq(id, 1);
        assertEq(roots.lockCount(), 1);
        assertEq(roots.totalLocked(), amount);
        assertEq(sprout.balanceOf(address(roots)), amount);
        assertEq(sprout.balanceOf(alice), 48_000_000 * E18);

        SproutRootLock.Lock memory l = roots.getLock(id);
        assertEq(l.owner, alice);
        assertEq(l.amount, amount);
        assertEq(l.lockDays, 90);
        assertEq(l.unlockAt, unlockAt);
        assertFalse(l.withdrawn);
        assertEq(roots.locksOf(alice).length, 1);
        assertEq(roots.activeLocksOf(alice)[0], 1);
        assertEq(roots.locksOf(bob).length, 0);
    }

    function test_lock_eachAllowedDuration() public {
        uint256[3] memory durations = [uint256(30), 90, 180];
        for (uint256 i; i < 3; ++i) {
            uint256 id = _lock(alice, E18, durations[i]);
            assertEq(roots.getLock(id).unlockAt, block.timestamp + durations[i] * 1 days);
            assertEq(roots.getLock(id).lockDays, durations[i]);
        }
    }

    function test_lock_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.ZeroAmount.selector);
        roots.lock(0, 30);
    }

    function test_lock_revertsOnBadDurations() public {
        uint256[9] memory bad = [uint256(0), 1, 29, 31, 60, 89, 91, 179, 181];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(SproutRootLock.BadDuration.selector);
            roots.lock(E18, bad[i]);
        }
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.BadDuration.selector);
        roots.lock(E18, 365);
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.BadDuration.selector);
        roots.lock(E18, type(uint256).max);
    }

    function test_lock_revertsWithoutApproval() public {
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(roots), 0, E18)
        );
        roots.lock(E18, 30);
    }

    function test_lock_revertsBeyondBalance() public {
        sprout.mint(carol, E18);
        vm.startPrank(carol);
        sprout.approve(address(roots), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, carol, E18, 2 * E18));
        roots.lock(2 * E18, 30);
        vm.stopPrank();
    }

    function test_lock_onlyPullsFromTheCaller() public {
        // Bob approved the lock for everything; Alice still cannot lock Bob's tokens.
        uint256 bobBefore = sprout.balanceOf(bob);
        _lock(alice, 5 * E18, 30);
        assertEq(sprout.balanceOf(bob), bobBefore);
        assertEq(roots.getLock(1).owner, alice);
    }

    function test_lock_creditsOnlyWhatArrives_feeOnTransfer() public {
        FeeToken fee = new FeeToken(100); // 1%
        SproutRootLock feeRoots = new SproutRootLock(IERC20(address(fee)));
        fee.mint(alice, 1_000 * E18);
        vm.startPrank(alice);
        fee.approve(address(feeRoots), type(uint256).max);
        uint256 id = feeRoots.lock(1_000 * E18, 30);
        vm.stopPrank();
        assertEq(feeRoots.getLock(id).amount, 990 * E18);
        assertEq(feeRoots.totalLocked(), 990 * E18);
        assertEq(fee.balanceOf(address(feeRoots)), 990 * E18);

        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        feeRoots.withdraw(id);
        assertEq(feeRoots.totalLocked(), 0);
        assertEq(fee.balanceOf(address(feeRoots)), 0);
    }

    function test_lock_revertsWhenNothingArrives() public {
        FeeToken fee = new FeeToken(10_000); // burns everything
        SproutRootLock feeRoots = new SproutRootLock(IERC20(address(fee)));
        fee.mint(alice, E18);
        vm.startPrank(alice);
        fee.approve(address(feeRoots), type(uint256).max);
        vm.expectRevert(SproutRootLock.ZeroAmount.selector);
        feeRoots.lock(E18, 30);
        vm.stopPrank();
    }

    function test_lock_donationsDoNotCountForAnyone() public {
        sprout.mint(address(roots), 7 * E18); // someone sends SPROUT straight to the contract
        _lock(alice, 3 * E18, 30);
        assertEq(roots.getLock(1).amount, 3 * E18);
        assertEq(roots.totalLocked(), 3 * E18);
    }

    // ------------------------------------------------------------------ withdraw

    function test_withdraw_atExactUnlockTime() public {
        uint256 amount = 1_234 * E18;
        uint256 id = _lock(alice, amount, 30);
        uint256 unlockAt = roots.getLock(id).unlockAt;
        uint256 before = sprout.balanceOf(alice);

        vm.warp(unlockAt);
        vm.expectEmit(true, true, false, true, address(roots));
        emit Withdrawn(id, alice, amount);
        vm.prank(alice);
        roots.withdraw(id);

        assertEq(sprout.balanceOf(alice), before + amount);
        assertEq(roots.totalLocked(), 0);
        assertTrue(roots.getLock(id).withdrawn);
        assertEq(roots.activeLocksOf(alice).length, 0);
        assertEq(roots.locksOf(alice).length, 1);
    }

    function test_withdraw_oneSecondEarlyReverts() public {
        uint256 id = _lock(alice, E18, 180);
        uint256 unlockAt = roots.getLock(id).unlockAt;
        vm.warp(unlockAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SproutRootLock.StillLocked.selector, unlockAt));
        roots.withdraw(id);
        // Straight after locking, too.
        vm.warp(unlockAt - 180 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SproutRootLock.StillLocked.selector, unlockAt));
        roots.withdraw(id);
    }

    function test_withdraw_longAfterUnlockStillWorks() public {
        uint256 id = _lock(alice, E18, 90);
        vm.warp(block.timestamp + 5 * 365 days);
        vm.prank(alice);
        roots.withdraw(id);
        assertEq(roots.totalLocked(), 0);
    }

    function test_withdraw_twiceReverts() public {
        uint256 id = _lock(alice, E18, 30);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        roots.withdraw(id);
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.AlreadyWithdrawn.selector);
        roots.withdraw(id);
    }

    function test_withdraw_wrongSenderReverts_beforeAndAfterUnlock() public {
        uint256 id = _lock(alice, E18, 30);
        vm.prank(bob);
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id);
        vm.warp(block.timestamp + 31 days);
        vm.prank(bob);
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id);
        // Not even the deployer of the lock contract.
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id);
        assertEq(roots.totalLocked(), E18);
    }

    function test_withdraw_unknownLockReverts() public {
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.UnknownLock.selector);
        roots.withdraw(0);
        _lock(alice, E18, 30);
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.UnknownLock.selector);
        roots.withdraw(2);
    }

    function test_multipleLocks_independentDatesAndOwners() public {
        uint256 a30 = _lock(alice, 100 * E18, 30);
        uint256 b90 = _lock(bob, 200 * E18, 90);
        uint256 a180 = _lock(alice, 300 * E18, 180);
        uint256 a90 = _lock(alice, 400 * E18, 90);
        assertEq(roots.totalLocked(), 1_000 * E18);
        assertEq(roots.locksOf(alice).length, 3);
        assertEq(roots.activeLocksOf(bob)[0], b90);

        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        roots.withdraw(a30);
        uint256[] memory active = roots.activeLocksOf(alice);
        assertEq(active.length, 2);
        assertEq(active[0], a180);
        assertEq(active[1], a90);
        assertEq(roots.totalLocked(), 900 * E18);

        uint256 a90Unlock = roots.getLock(a90).unlockAt;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SproutRootLock.StillLocked.selector, a90Unlock));
        roots.withdraw(a90);

        vm.warp(block.timestamp + 60 days);
        vm.prank(alice);
        roots.withdraw(a90);
        vm.prank(bob);
        roots.withdraw(b90);
        assertEq(roots.totalLocked(), 300 * E18);
        assertEq(roots.activeLocksOf(alice).length, 1);
        assertEq(roots.activeLocksOf(bob).length, 0);

        vm.warp(block.timestamp + 90 days);
        vm.prank(alice);
        roots.withdraw(a180);
        assertEq(roots.totalLocked(), 0);
        assertEq(sprout.balanceOf(address(roots)), 0);
        assertEq(sprout.balanceOf(alice), 50_000_000 * E18);
        assertEq(sprout.balanceOf(bob), 10_000_000 * E18);
    }

    // ------------------------------------------------------------------ reentrancy

    function test_reentrancy_duringLockIsBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        SproutRootLock evilRoots = new SproutRootLock(IERC20(address(evil)));
        evil.mint(alice, 10 * E18);
        vm.prank(alice);
        evil.approve(address(evilRoots), type(uint256).max);
        evil.arm(evilRoots, false, 0);
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        evilRoots.lock(E18, 30);
    }

    function test_reentrancy_duringWithdrawIsBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        SproutRootLock evilRoots = new SproutRootLock(IERC20(address(evil)));
        evil.mint(alice, 10 * E18);
        vm.prank(alice);
        evil.approve(address(evilRoots), type(uint256).max);
        vm.prank(alice);
        uint256 id = evilRoots.lock(E18, 30);
        vm.warp(block.timestamp + 30 days);
        evil.arm(evilRoots, true, id);
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        evilRoots.withdraw(id);
        assertEq(evilRoots.totalLocked(), E18);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_lockAndWithdraw(uint256 amount, uint8 pick, uint32 lateBy) public {
        amount = bound(amount, 1, 50_000_000 * E18);
        uint256 days_ = pick % 3 == 0 ? 30 : pick % 3 == 1 ? 90 : 180;
        uint256 start = block.timestamp;
        uint256 id = _lock(alice, amount, days_);
        SproutRootLock.Lock memory l = roots.getLock(id);
        assertEq(l.amount, amount);
        assertEq(l.unlockAt, start + days_ * 1 days);
        assertEq(roots.totalLocked(), amount);

        vm.warp(l.unlockAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SproutRootLock.StillLocked.selector, l.unlockAt));
        roots.withdraw(id);

        vm.warp(uint256(l.unlockAt) + lateBy);
        vm.prank(bob);
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id);
        vm.prank(alice);
        roots.withdraw(id);
        assertEq(roots.totalLocked(), 0);
        assertEq(sprout.balanceOf(alice), 50_000_000 * E18);
    }

    function testFuzz_rejectsEveryOtherDuration(uint256 days_) public {
        vm.assume(days_ != 30 && days_ != 90 && days_ != 180);
        vm.prank(alice);
        vm.expectRevert(SproutRootLock.BadDuration.selector);
        roots.lock(E18, days_);
    }

    function testFuzz_totalLockedIsTheSumOfOpenLocks(uint96[6] memory raw, uint8 withdrawMask) public {
        uint256[3] memory durations = [uint256(30), 90, 180];
        uint256[6] memory ids;
        uint256 sum;
        for (uint256 i; i < 6; ++i) {
            uint256 amount = bound(uint256(raw[i]), 1, 1_000_000 * E18);
            ids[i] = _lock(i % 2 == 0 ? alice : bob, amount, durations[i % 3]);
            sum += amount;
        }
        assertEq(roots.totalLocked(), sum);
        vm.warp(block.timestamp + 180 days);
        for (uint256 i; i < 6; ++i) {
            if (withdrawMask & (1 << i) == 0) continue;
            SproutRootLock.Lock memory l = roots.getLock(ids[i]);
            vm.prank(l.owner);
            roots.withdraw(ids[i]);
            sum -= l.amount;
        }
        assertEq(roots.totalLocked(), sum);
        assertEq(sprout.balanceOf(address(roots)), sum);
        assertEq(roots.activeLocksOf(alice).length + roots.activeLocksOf(bob).length, 6 - _popcount(withdrawMask & 63));
    }

    function _popcount(uint256 x) internal pure returns (uint256 n) {
        for (; x != 0; x >>= 1) {
            n += x & 1;
        }
    }
}
