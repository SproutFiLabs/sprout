// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SproutRootLock
/// @notice "Root your SPROUT": an optional time-lock. A holder locks their own SPROUT for 30, 90 or
///         180 days and takes the same tokens back, to the same wallet, on or after the date they
///         chose. That is all it does. It pays nothing: no rewards, no yield, no interest.
///
/// @dev No owner, no admin, no pause, no upgrade and no early exit. Nobody, the deployer included,
///      can unlock a lock early or move anyone's tokens: `lock` only pulls from the caller, and
///      `withdraw` only pays a lock's own owner. The Sprout app reads locks to count them toward
///      holder tiers; that happens off-chain and changes nothing here.
contract SproutRootLock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Lock {
        address owner;
        uint64 unlockAt;
        uint16 lockDays;
        bool withdrawn;
        uint256 amount;
    }

    IERC20 public immutable token;
    /// @notice SPROUT held for locks not yet withdrawn.
    uint256 public totalLocked;
    /// @notice Locks ever made; ids run from 1 to lockCount.
    uint256 public lockCount;

    mapping(uint256 => Lock) private _locks;
    mapping(address => uint256[]) private _locksOf;

    event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 lockDays, uint256 unlockAt);
    event Withdrawn(uint256 indexed lockId, address indexed owner, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error BadDuration();
    error UnknownLock();
    error NotLockOwner();
    error StillLocked(uint256 unlockAt);
    error AlreadyWithdrawn();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice Locks `amount` of the caller's SPROUT for `days_` (30, 90 or 180) days.
    /// @dev Credits what actually arrived, so a fee-on-transfer token can never over-credit.
    function lock(uint256 amount, uint256 days_) external nonReentrant returns (uint256 lockId) {
        if (amount == 0) revert ZeroAmount();
        if (days_ != 30 && days_ != 90 && days_ != 180) revert BadDuration();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 credited = token.balanceOf(address(this)) - before;
        if (credited == 0) revert ZeroAmount();

        // casting to 'uint64' is safe because a timestamp plus at most 180 days is far below 2^64
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 unlockAt = uint64(block.timestamp + days_ * 1 days);
        lockId = ++lockCount;
        // casting to 'uint16' is safe because days_ is 30, 90 or 180 (checked above)
        // forge-lint: disable-next-line(unsafe-typecast)
        _locks[lockId] = Lock(msg.sender, unlockAt, uint16(days_), false, credited);
        _locksOf[msg.sender].push(lockId);
        totalLocked += credited;
        emit Locked(lockId, msg.sender, credited, days_, unlockAt);
    }

    /// @notice Returns a lock's tokens to its owner, once, on or after its unlock time.
    function withdraw(uint256 lockId) external nonReentrant {
        Lock storage l = _locks[lockId];
        if (l.owner == address(0)) revert UnknownLock();
        if (l.owner != msg.sender) revert NotLockOwner();
        if (l.withdrawn) revert AlreadyWithdrawn();
        // A block producer's few seconds of timestamp leeway can't matter against a 30-day minimum.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < l.unlockAt) revert StillLocked(l.unlockAt);

        l.withdrawn = true;
        uint256 amount = l.amount;
        totalLocked -= amount;
        emit Withdrawn(lockId, msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    function getLock(uint256 lockId) external view returns (Lock memory) {
        return _locks[lockId];
    }

    /// @notice Every lock id `owner` ever made, oldest first.
    function locksOf(address owner) external view returns (uint256[] memory) {
        return _locksOf[owner];
    }

    /// @notice Lock ids of `owner` not yet withdrawn (still locked, or due and waiting), oldest first.
    function activeLocksOf(address owner) external view returns (uint256[] memory ids) {
        uint256[] storage all = _locksOf[owner];
        uint256 n;
        for (uint256 i; i < all.length; ++i) {
            if (!_locks[all[i]].withdrawn) ++n;
        }
        ids = new uint256[](n);
        n = 0;
        for (uint256 i; i < all.length; ++i) {
            if (!_locks[all[i]].withdrawn) ids[n++] = all[i];
        }
    }
}
