// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {SproutGuardian} from "../src/SproutGuardian.sol";
import {GuardianWebAuthn} from "../src/GuardianWebAuthn.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {SproutVault} from "../src/SproutVault.sol";
import {SproutFactory} from "../src/SproutFactory.sol";

contract GuardianTest is Test {
    SproutGuardian w;
    MockERC20 token;
    address own = address(11);
    address g1 = address(21);
    address g2 = address(22);
    address g3 = address(23);
    address next = address(31);
    address stranger = address(41);
    address[3] gs;
    bytes32 device = keccak256("device");
    uint256 pkey = 111;

    function setUp() public {
        vm.warp(1700000000);
        gs = [g1, g2, g3];
        token = new MockERC20("USD", "USD", 6);
        w = new SproutGuardian(own, gs, address(token), 100e6, sha256("localhost"), "http://localhost:5174");
        token.mint(address(w), 10000e6);
        vm.deal(address(w), 5 ether);
    }

    function addKey() internal {
        (uint256 x, uint256 y) = vm.publicKeyP256(pkey);
        vm.prank(own);
        w.addDevice(device, bytes32(x), bytes32(y), uint64(block.timestamp + 365 days));
    }

    function assertion(bytes32 hash) internal returns (GuardianWebAuthn.Assertion memory a) {
        a.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"http://localhost:5174","crossOrigin":false}'
        );
        a.typeIndex = 1;
        a.challengeIndex = 23;
        a.originIndex = 81;
        a.authenticatorData = abi.encodePacked(sha256("localhost"), bytes1(0x05), bytes4(0));
        (a.r, a.s) = vm.signP256(pkey, sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON)))));
    }

    function quorum() internal {
        vm.prank(g1);
        w.startRecovery(next);
        uint256 id = w.recoveryId();
        vm.prank(g2);
        w.approveRecovery(id);
    }

    function queue(uint256 amount, address to) internal {
        vm.prank(own);
        w.act(1, to, address(token), amount);
    }

    function testOwnerCannotBypassBudget() public {
        vm.startPrank(own);
        w.act(0, own, address(token), 70e6);
        vm.expectRevert(SproutGuardian.UseQueue.selector);
        w.act(0, own, address(token), 31e6);
        w.act(0, own, address(token), 30e6);
        vm.stopPrank();
        assertEq(w.remaining(address(token)), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(w.remaining(address(token)), 100e6);
    }

    function testNewDestinationWaits() public {
        vm.prank(own);
        vm.expectRevert(SproutGuardian.UseQueue.selector);
        w.act(0, stranger, address(token), 1);
        queue(500e6, stranger);
        vm.expectRevert(SproutGuardian.NotReady.selector);
        w.executeTransfer(1);
        vm.warp(block.timestamp + 1 days);
        w.executeTransfer(1);
        assertEq(token.balanceOf(stranger), 500e6);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeTransfer(1);
    }

    function testGuardianCanCancelQueuedTransferButCannotSpend() public {
        queue(500e6, stranger);
        vm.prank(g1);
        w.cancelTransfer(1);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeTransfer(1);
        vm.prank(g1);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.act(0, own, address(token), 1);
    }

    function testExpiredTransferCannotExecute() public {
        queue(500e6, stranger);
        vm.warp(block.timestamp + 9 days);
        vm.expectRevert(SproutGuardian.Expired.selector);
        w.executeTransfer(1);
    }

    function testTwoDistinctApprovalsAndDelayRequired() public {
        vm.prank(g1);
        w.startRecovery(next);
        vm.prank(g1);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.approveRecovery(1);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeRecovery(1);
        vm.prank(g2);
        w.approveRecovery(1);
        vm.expectRevert(SproutGuardian.NotReady.selector);
        w.executeRecovery(1);
        vm.warp(block.timestamp + 2 days);
        w.executeRecovery(1);
        assertEq(w.owner(), next);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeRecovery(1);
    }

    function testRecoveryRevokesAllOldDevicesAndQueuedTransfers() public {
        addKey();
        queue(500e6, stranger);
        quorum();
        vm.warp(block.timestamp + 2 days);
        w.executeRecovery(1);
        assertEq(w.epoch(), 2);
        assertFalse(w.trusted(own));
        assertTrue(w.trusted(next));
        assertEq(w.deviceIds().length, 0);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeTransfer(1);
        GuardianWebAuthn.Assertion memory a;
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, next, address(token), 1, uint64(block.timestamp + 60), device, a);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.act(0, next, address(token), 1);
    }

    function testQuorumTemporarilyFreezesOutgoingFunds() public {
        queue(500e6, stranger);
        quorum();
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(SproutGuardian.RecoveryPending.selector);
        w.executeTransfer(1);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.RecoveryPending.selector);
        w.act(0, own, address(token), 1);
        vm.prank(own);
        w.cancelRecovery();
        w.executeTransfer(1);
    }

    function testSingleGuardianCannotStartArbitraryRecoveryOrVoteForOwner() public {
        vm.prank(stranger);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.startRecovery(next);
        vm.prank(g1);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.startRecovery(g1);
    }

    function testOwnerCanCancelAndVotesDoNotCarryOver() public {
        quorum();
        vm.prank(own);
        w.cancelRecovery();
        vm.prank(g1);
        w.startRecovery(next);
        (,,, uint8 approvals,) = w.recovery();
        assertEq(approvals, 1);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeRecovery(2);
    }

    function testExpiredRecoveryCannotExecute() public {
        quorum();
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(SproutGuardian.Expired.selector);
        w.executeRecovery(1);
    }

    function testPolicyChangesDelayedAndVetoable() public {
        vm.prank(own);
        w.queuePolicy(address(token), 500e6, stranger, gs);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.NotReady.selector);
        w.executePolicy(address(token), 500e6, stranger, gs);
        vm.prank(g1);
        w.cancelPolicy();
        vm.warp(block.timestamp + 2 days);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executePolicy(address(token), 500e6, stranger, gs);
    }

    function testPolicyCannotBeSubstitutedOrReplayed() public {
        vm.prank(own);
        w.queuePolicy(address(token), 500e6, stranger, gs);
        vm.warp(block.timestamp + 2 days);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executePolicy(address(token), 501e6, stranger, gs);
        vm.prank(own);
        w.executePolicy(address(token), 500e6, stranger, gs);
        assertTrue(w.trusted(stranger));
        vm.prank(own);
        w.act(0, stranger, address(token), 500e6);
        vm.prank(own);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executePolicy(address(token), 500e6, stranger, gs);
    }

    function testTighteningDoesNotResetSpend() public {
        vm.prank(own);
        w.act(0, own, address(token), 70e6);
        vm.prank(own);
        w.tighten(address(token), 20e6, address(0));
        assertEq(w.remaining(address(token)), 0);
    }

    function testPasskeySignsActualActionAndCannotReplay() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 10e6, deadline));
        w.actWithPasskey(0, own, address(token), 10e6, deadline, device, a);
        assertEq(token.balanceOf(own), 10e6);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 10e6, deadline, device, a);
    }

    function testPasskeyCannotChangeAmountOrChain() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 10e6, deadline));
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 11e6, deadline, device, a);
        vm.chainId(998);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 10e6, deadline, device, a);
    }

    function testPasskeyStillObeysLimits() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 101e6, deadline));
        vm.expectRevert(SproutGuardian.UseQueue.selector);
        w.actWithPasskey(0, own, address(token), 101e6, deadline, device, a);
        assertEq(w.nonce(), 0);
    }

    function testRevokedDeviceIsRejected() public {
        addKey();
        vm.prank(g1);
        w.revokeDevice(device);
        GuardianWebAuthn.Assertion memory a;
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, uint64(block.timestamp + 60), device, a);
    }

    function testInvalidWebAuthnFieldsAreRejected() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 1, deadline));
        a.challengeIndex = type(uint256).max;
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        a = assertion(w.challenge(0, own, address(token), 1, deadline));
        a.authenticatorData[32] = 0x01;
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        a = assertion(w.challenge(0, own, address(token), 1, deadline));
        a.authenticatorData[0] = 0xff;
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
    }

    function resign(GuardianWebAuthn.Assertion memory a) internal returns (GuardianWebAuthn.Assertion memory) {
        (a.r, a.s) = vm.signP256(pkey, sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON)))));
        return a;
    }

    function testValidSignaturesStillRequireUserVerificationOriginAndRp() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        bytes32 c = w.challenge(0, own, address(token), 1, deadline);
        GuardianWebAuthn.Assertion memory a = assertion(c);
        a.authenticatorData[32] = 0x01;
        a = resign(a);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        a = assertion(c);
        a.authenticatorData[0] = 0xff;
        a = resign(a);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        a = assertion(c);
        a.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(c)),
            '","origin":"https://evil.example"}'
        );
        a = resign(a);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        a = assertion(c);
        a.authenticatorData[32] = 0x15;
        a = resign(a);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
    }

    function testExpiredSignatureAndDeviceRejected() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 1, deadline));
        vm.warp(block.timestamp + 61);
        vm.expectRevert(SproutGuardian.Expired.selector);
        w.actWithPasskey(0, own, address(token), 1, deadline, device, a);
        vm.warp(block.timestamp + 366 days);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.actWithPasskey(0, own, address(token), 1, uint64(block.timestamp + 60), device, a);
    }

    function testGuardianRotationInvalidatesRecoveryVotes() public {
        quorum();
        address[3] memory replacement = [address(51), address(52), address(53)];
        vm.prank(own);
        w.queuePolicy(address(token), 100e6, address(0), replacement);
        vm.warp(block.timestamp + 2 days);
        vm.prank(own);
        w.executePolicy(address(token), 100e6, address(0), replacement);
        vm.expectRevert(SproutGuardian.Invalid.selector);
        w.executeRecovery(1);
        vm.prank(g1);
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        w.startRecovery(next);
        vm.prank(replacement[0]);
        w.startRecovery(next);
        (,,, uint8 approvals,) = w.recovery();
        assertEq(approvals, 1);
    }

    function testCrossWalletPasskeyReplayFails() public {
        addKey();
        uint64 deadline = uint64(block.timestamp + 60);
        GuardianWebAuthn.Assertion memory a = assertion(w.challenge(0, own, address(token), 1, deadline));
        SproutGuardian other =
            new SproutGuardian(own, gs, address(token), 100e6, sha256("localhost"), "http://localhost:5174");
        (uint256 x, uint256 y) = vm.publicKeyP256(pkey);
        vm.prank(own);
        other.addDevice(device, bytes32(x), bytes32(y), uint64(block.timestamp + 1 days));
        vm.expectRevert(SproutGuardian.Unauthorized.selector);
        other.actWithPasskey(0, own, address(token), 1, deadline, device, a);
    }

    function testNativeCurrencyAlsoWaits() public {
        vm.prank(own);
        vm.expectRevert(SproutGuardian.UseQueue.selector);
        w.act(0, own, address(0), 1 ether);
        vm.prank(own);
        w.act(1, own, address(0), 1 ether);
        vm.warp(block.timestamp + 1 days);
        w.executeTransfer(1);
        assertEq(own.balance, 1 ether);
    }

    function testInvalidGuardianSetRejected() public {
        bytes32 rp = sha256("localhost");
        vm.expectRevert(SproutGuardian.Invalid.selector);
        new SproutGuardian(own, [g1, g1, g3], address(token), 1, rp, "x");
    }

    function testGraduationAndAllowanceCannotBypassWalletPolicy() public {
        SproutVault impl = new SproutVault();
        address[] memory assets = new address[](1);
        assets[0] = address(new MockERC20("A", "A", 18));
        address[] memory venues = new address[](0);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10000;
        SproutFactory factory = new SproutFactory(address(impl), address(token), assets, venues);
        SproutVault vault = SproutVault(
            factory.createSprout(address(w), address(token), assets, weights, uint64(block.timestamp + 5 days), venues)
        );
        token.mint(address(vault), 500e6);
        vault.createMilestone(keccak256("chore"), address(token), 20e6, 0);
        vault.releaseMilestone(keccak256("chore"));
        vm.prank(own);
        w.act(2, address(vault), address(token), 20e6);
        assertEq(token.balanceOf(address(w)), 10020e6);
        vm.prank(own);
        vm.expectRevert();
        w.act(3, address(vault), address(token), 480e6);
        vm.warp(block.timestamp + 5 days);
        vm.prank(own);
        w.act(3, address(vault), address(token), 480e6);
        assertEq(token.balanceOf(address(w)), 10500e6);
        assertEq(token.balanceOf(own), 0);
    }

    function testFuzz_BudgetNeverExceeded(uint128 a, uint128 b) public {
        a = uint128(bound(a, 1, 100e6));
        b = uint128(bound(b, 1, 100e6));
        vm.startPrank(own);
        w.act(0, own, address(token), a);
        if (uint256(a) + b > 100e6) vm.expectRevert(SproutGuardian.UseQueue.selector);
        w.act(0, own, address(token), b);
        vm.stopPrank();
        assertLe(token.balanceOf(own), 100e6);
    }
}
