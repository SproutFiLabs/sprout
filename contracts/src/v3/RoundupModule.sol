// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRoundupSprout {
    function parent() external view returns (address);
    function settlementToken() external view returns (address);
    function fund(address, uint256) external;
}

/// The wallet owner delegates a bounded weekly pull to a named executor.
/// Transfer observation and rounding are off-chain; the on-chain cap is absolute.
contract RoundupModule is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Rule {
        address wallet;
        address vault;
        address executor;
        address token;
        uint256 cap;
        uint64 starts;
        uint64 expires;
        uint64 nextSweep;
        uint256 total;
        bool active;
    }
    mapping(bytes32 => Rule) public rules;
    event Linked(bytes32 indexed id, address indexed wallet, address indexed vault, uint256 cap);
    event Swept(bytes32 indexed id, uint256 amount, bytes32 ledgerHash);
    event Unlinked(bytes32 indexed id);
    error Invalid();
    error Unauthorized();

    function link(address vault, address executor, uint256 cap, uint64 expires) external returns (bytes32 id) {
        if (
            cap == 0 || executor == address(0) || expires <= block.timestamp + 7 days
                || expires > block.timestamp + 366 days
        ) {
            revert Invalid();
        }
        if (IRoundupSprout(vault).parent() != msg.sender) revert Unauthorized();
        id = keccak256(abi.encode(msg.sender, vault));
        Rule storage old = rules[id];
        uint64 next = old.nextSweep > block.timestamp ? old.nextSweep : uint64(block.timestamp + 7 days);
        rules[id] = Rule(
            msg.sender,
            vault,
            executor,
            IRoundupSprout(vault).settlementToken(),
            cap,
            uint64(block.timestamp),
            expires,
            next,
            old.total,
            true
        );
        emit Linked(id, msg.sender, vault, cap);
    }

    function unlink(bytes32 id) external {
        if (rules[id].wallet != msg.sender) revert Unauthorized();
        rules[id].active = false;
        emit Unlinked(id);
    }

    function sweep(bytes32 id, uint256 amount, bytes32 ledgerHash) external nonReentrant {
        Rule storage r = rules[id];
        if (!r.active || r.executor != msg.sender) revert Unauthorized();
        if (
            block.timestamp >= r.expires || block.timestamp < r.nextSweep || amount == 0 || amount > r.cap
                || ledgerHash == bytes32(0)
        ) {
            revert Invalid();
        }
        r.nextSweep = uint64(block.timestamp + 7 days);
        r.total += amount;
        uint256 before = IERC20(r.token).balanceOf(address(this));
        IERC20(r.token).safeTransferFrom(r.wallet, address(this), amount);
        if (IERC20(r.token).balanceOf(address(this)) - before != amount) revert Invalid();
        IERC20(r.token).forceApprove(r.vault, amount);
        IRoundupSprout(r.vault).fund(r.token, amount);
        IERC20(r.token).forceApprove(r.vault, 0);
        emit Swept(id, amount, ledgerHash);
    }
}
