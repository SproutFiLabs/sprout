// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SproutRootLock} from "../src/SproutRootLock.sol";

/// @notice Mainnet-fork rehearsal against the real SPROUT token on Robinhood Chain (4663).
///         Finds a real holder from recent Transfer logs, impersonates them, then locks (30 and
///         180 days), warps and withdraws, checking balances and totalLocked at every step.
///
///         Runs only when SPROUT_MAINNET_RPC is set (it is skipped otherwise):
///           SPROUT_MAINNET_RPC=... forge test --root contracts --match-contract RootLockForkTest -vv
///         SPROUT_ROOT_FORK_HOLDER=0x... pins the holder instead of searching.
contract RootLockForkTest is Test {
    IERC20 constant SPROUT = IERC20(0x5Ec27C931Fb49911128dddf7d914C1754dA9f49F);
    bytes32 constant TRANSFER = keccak256("Transfer(address,address,uint256)");
    /// The public node answers one wide eth_getLogs (then rate-limits); Alchemy's free tier only
    /// takes 10-block ranges, so it is the slow fallback.
    string constant PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
    uint256 constant WIDE = 20_000;
    uint256 constant NARROW = 10;
    uint256 constant MAX_NARROW_WINDOWS = 300;
    uint256 constant MAX_CANDIDATES = 60;

    SproutRootLock roots;

    /// Recent SPROUT Transfer logs, newest block last.
    function _recentTransfers(uint256 mainFork) internal returns (Vm.EthGetLogs[] memory logs) {
        uint256 head = block.number;
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = TRANSFER;
        // The public node can lag the head by a few blocks, so it forks a little behind.
        try vm.createSelectFork(PUBLIC_RPC, head - 200) {
            try vm.eth_getLogs(head - 200 - WIDE, head - 200, address(SPROUT), topics) returns (
                Vm.EthGetLogs[] memory wide
            ) {
                logs = wide;
            } catch {}
        } catch {}
        vm.selectFork(mainFork);
        if (logs.length > 0) return logs;
        for (uint256 w; w < MAX_NARROW_WINDOWS; ++w) {
            uint256 to = head - w * NARROW;
            logs = vm.eth_getLogs(to - NARROW + 1, to, address(SPROUT), topics);
            if (logs.length > 0) return logs;
        }
    }

    /// The largest person's wallet (no code: skips pools, routers and delegated accounts) among
    /// the most recent senders and recipients, or SPROUT_ROOT_FORK_HOLDER when set.
    function _holder(uint256 mainFork) internal returns (address best, uint256 bestBalance) {
        best = vm.envOr("SPROUT_ROOT_FORK_HOLDER", address(0));
        if (best != address(0)) return (best, SPROUT.balanceOf(best));
        Vm.EthGetLogs[] memory logs = _recentTransfers(mainFork);
        address[] memory seen = new address[](MAX_CANDIDATES);
        uint256 n;
        for (uint256 i = logs.length; i > 0 && n < MAX_CANDIDATES; --i) {
            if (logs[i - 1].topics.length < 3) continue;
            for (uint256 t = 1; t <= 2 && n < MAX_CANDIDATES; ++t) {
                address who = address(uint160(uint256(logs[i - 1].topics[t])));
                // Skip 0x0, 0x…dEaD and other mostly-zero (burn) addresses: nobody's wallet.
                if (uint160(who) < type(uint128).max || _contains(seen, n, who)) continue;
                seen[n++] = who;
                if (who.code.length != 0) continue;
                uint256 bal = SPROUT.balanceOf(who);
                if (bal > bestBalance) (best, bestBalance) = (who, bal);
            }
        }
        console2.log("candidates checked", n);
    }

    function _contains(address[] memory list, uint256 n, address who) internal pure returns (bool) {
        for (uint256 i; i < n; ++i) {
            if (list[i] == who) return true;
        }
        return false;
    }

    function test_fork_realHolderLocksWarpsAndWithdraws() public {
        string memory rpc = vm.envOr("SPROUT_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "SPROUT_MAINNET_RPC not set");
            return;
        }
        uint256 mainFork = vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663, "not Robinhood Chain mainnet");
        assertEq(SPROUT.totalSupply(), 1_000_000_000e18, "SPROUT supply");

        roots = new SproutRootLock(SPROUT);
        (address holder, uint256 start) = _holder(mainFork);
        assertTrue(holder != address(0) && start > 0, "no SPROUT holder found in recent transfers");
        console2.log("fork block", block.number);
        console2.log("holder", holder);
        console2.log("holder SPROUT (whole)", start / 1e18);

        uint256 first = start / 2;
        uint256 second = start / 4;

        vm.startPrank(holder, holder);
        SPROUT.approve(address(roots), first + second);
        uint256 id30 = roots.lock(first, 30);
        uint256 id180 = roots.lock(second, 180);
        vm.stopPrank();

        // The real token moves exactly what was asked (no transfer fee), so the credit is exact.
        assertEq(roots.getLock(id30).amount, first, "credited first lock");
        assertEq(roots.getLock(id180).amount, second, "credited second lock");
        assertEq(roots.totalLocked(), first + second, "totalLocked after locks");
        assertEq(SPROUT.balanceOf(address(roots)), first + second, "lock contract balance");
        assertEq(SPROUT.balanceOf(holder), start - first - second, "holder after locks");
        assertEq(roots.activeLocksOf(holder).length, 2);

        // Nobody else, before or after the date, and not the holder early.
        vm.prank(address(0xBAD));
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id30);
        uint256 unlock30 = roots.getLock(id30).unlockAt;
        vm.warp(unlock30 - 1);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(SproutRootLock.StillLocked.selector, unlock30));
        roots.withdraw(id30);

        vm.warp(unlock30);
        vm.prank(address(0xBAD));
        vm.expectRevert(SproutRootLock.NotLockOwner.selector);
        roots.withdraw(id30);
        vm.prank(holder, holder);
        roots.withdraw(id30);
        assertEq(SPROUT.balanceOf(holder), start - second, "holder after first withdraw");
        assertEq(roots.totalLocked(), second, "totalLocked after first withdraw");
        vm.prank(holder);
        vm.expectRevert(SproutRootLock.AlreadyWithdrawn.selector);
        roots.withdraw(id30);

        vm.warp(roots.getLock(id180).unlockAt);
        vm.prank(holder, holder);
        roots.withdraw(id180);
        assertEq(SPROUT.balanceOf(holder), start, "holder whole again");
        assertEq(roots.totalLocked(), 0, "totalLocked back to zero");
        assertEq(SPROUT.balanceOf(address(roots)), 0, "lock contract empty");
        assertEq(roots.activeLocksOf(holder).length, 0);

        console2.log("locked 30d (whole)", first / 1e18);
        console2.log("locked 180d (whole)", second / 1e18);
        // Gas is not reported here: a forge test is one transaction, so every slot is warm after
        // first use. scripts/fork-root-lock.ts measures real transaction receipts on an Anvil fork.
    }
}
