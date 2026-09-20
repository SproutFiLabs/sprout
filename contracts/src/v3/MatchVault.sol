// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMatchSprout {
    function parent() external view returns (address);
    function settlementToken() external view returns (address);
    function matchVault() external view returns (address);
}

/// Sponsor-funded matching. Only the target vault can report contributions;
/// matched funds transfer directly to it and cannot recursively trigger matches.
contract MatchVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant PERIOD = 30 days;
    uint256 public constant MAX_SPONSORS = 32;

    struct Commitment {
        address sponsor;
        address vault;
        address token;
        uint256 cap;
        uint256 remaining;
        uint256 matched;
        uint64 starts;
        uint64 expires;
        uint64 window;
        uint256 windowSpent;
        bool cancelled;
    }
    mapping(uint256 => Commitment) public commitments;
    mapping(address => uint256[]) private slots;
    uint256 public nextId = 1;
    event MatchCommitted(
        uint256 indexed id, address indexed vault, address indexed sponsor, uint256 budget, uint256 cap, uint64 expires
    );
    event Matched(uint256 indexed id, uint256 contributionId, uint256 amount);
    event MatchCancelled(uint256 indexed id, uint256 refunded);
    error Invalid();
    error Unauthorized();

    function commit(address vault, uint256 budget, uint256 cap, uint8 periods)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (vault.code.length == 0 || budget == 0 || cap == 0 || cap > budget || periods == 0 || periods > 24) {
            revert Invalid();
        }
        IMatchSprout v = IMatchSprout(vault);
        if (v.matchVault() != address(this)) revert Invalid();
        address token = v.settlementToken();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), budget);
        if (IERC20(token).balanceOf(address(this)) - before != budget) revert Invalid();
        id = nextId++;
        commitments[id] = Commitment(
            msg.sender,
            vault,
            token,
            cap,
            budget,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp + periods * PERIOD),
            0,
            0,
            false
        );
        uint256[] storage ids = slots[vault];
        bool placed;
        for (uint256 i; i < ids.length; i++) {
            Commitment storage old = commitments[ids[i]];
            if (old.cancelled || old.remaining == 0 || block.timestamp >= old.expires) {
                ids[i] = id;
                placed = true;
                break;
            }
        }
        if (!placed) {
            if (ids.length >= MAX_SPONSORS) revert Invalid();
            ids.push(id);
        }
        emit MatchCommitted(id, vault, msg.sender, budget, cap, commitments[id].expires);
    }

    function activeIds(address vault) external view returns (uint256[] memory) {
        return slots[vault];
    }
    mapping(address => uint256) public lastContribution;

    function onContribution(address contributor, uint256 amount, uint256 contributionId) external nonReentrant {
        address vault = msg.sender;
        if (contributionId <= lastContribution[vault] || IMatchSprout(vault).parent() != contributor) revert Unauthorized();
        lastContribution[vault] = contributionId;
        uint256[] storage ids = slots[vault];
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            Commitment storage c = commitments[id];
            if (c.cancelled || block.timestamp >= c.expires || c.remaining == 0) continue;
            uint64 window = uint64((block.timestamp - c.starts) / PERIOD);
            if (c.window != window) {
                c.window = window;
                c.windowSpent = 0;
            }
            uint256 available = c.cap - c.windowSpent;
            uint256 payment = amount < available ? amount : available;
            if (payment > c.remaining) payment = c.remaining;
            if (payment == 0) continue;
            c.remaining -= payment;
            c.windowSpent += payment;
            c.matched += payment;
            IERC20(c.token).safeTransfer(vault, payment);
            emit Matched(id, contributionId, payment);
        }
    }

    function cancel(uint256 id) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.sponsor != msg.sender || c.cancelled) revert Unauthorized();
        uint256 refund = c.remaining;
        c.remaining = 0;
        c.cancelled = true;
        IERC20(c.token).safeTransfer(msg.sender, refund);
        emit MatchCancelled(id, refund);
    }
}
