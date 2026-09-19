// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {GuardianWebAuthn} from "./GuardianWebAuthn.sol";

interface IGuardianSprout {
    function beneficiary() external view returns (address);
    function claimAllowance(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount, address to) external;
}

/// @title Sprout Guardian — opt-in beneficiary smart wallet
/// @notice No proxy, admin, upgrade, arbitrary-call or token-approval escape hatch.
/// Every outgoing transfer uses the same policy, including owner transactions.
/// New destinations and over-budget transfers wait 24h. Recovery and policy
/// changes wait 48h. Any guardian may veto a queued transfer/configuration.
/// Guardians can recover control ONLY with 2-of-3 approvals plus 48h.
contract SproutGuardian is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint64 public constant TRANSFER_DELAY = 1 days;
    uint64 public constant RECOVERY_DELAY = 2 days;
    uint64 public constant REQUEST_LIFETIME = 7 days;
    bytes32 public constant VERSION = keccak256("SPROUT_GUARDIAN_V1");
    address public owner;
    address[3] public guardians;
    uint256 public epoch = 1;
    uint256 public nonce;
    bytes32 public immutable rpIdHash;
    string public origin;

    struct Device {
        bytes32 x;
        bytes32 y;
        uint64 expiresAt;
        uint256 epoch;
        bool enabled;
    }
    mapping(bytes32 => Device) public devices;
    bytes32[] private _deviceIds;

    struct Budget {
        uint256 limit;
        uint256 spent;
        uint64 resetAt;
    }
    mapping(address => Budget) public budgets;
    mapping(address => uint256) private _trustedEpoch;

    struct Transfer {
        address token;
        address to;
        uint256 amount;
        uint64 readyAt;
        uint256 epoch;
        bool closed;
    }
    mapping(uint256 => Transfer) public transfers;
    uint256 public transferCount;

    struct Recovery {
        address newOwner;
        uint64 readyAt;
        uint64 expiresAt;
        uint8 approvals;
        bool closed;
    }
    Recovery public recovery;
    uint256 public recoveryId;
    mapping(uint256 => mapping(address => bool)) public recoveryApproved;
    bytes32 public pendingPolicy;
    uint64 public policyReadyAt;

    event DeviceAdded(bytes32 indexed id, uint64 expiresAt, uint256 epoch);
    event DeviceRevoked(bytes32 indexed id);
    event TransferQueued(uint256 indexed id, address token, address to, uint256 amount, uint64 readyAt);
    event TransferClosed(uint256 indexed id, bool executed);
    event Transferred(address indexed token, address indexed to, uint256 amount);
    event RecoveryStarted(uint256 indexed id, address newOwner);
    event RecoveryApproved(uint256 indexed id, address guardian, uint8 approvals, uint64 readyAt);
    event RecoveryClosed(uint256 indexed id, bool executed);
    event PolicyQueued(bytes32 hash, uint64 readyAt);
    event PolicyApplied(bytes32 hash);
    event PolicyCancelled(bytes32 hash);
    error Unauthorized();
    error Invalid();
    error NotReady();
    error Expired();
    error UseQueue();
    error RecoveryPending();

    constructor(
        address owner_,
        address[3] memory guardians_,
        address token,
        uint256 dailyLimit,
        bytes32 rpIdHash_,
        string memory origin_
    ) {
        _validateGuardians(owner_, guardians_);
        if (rpIdHash_ == 0 || bytes(origin_).length == 0 || bytes(origin_).length > 255) revert Invalid();
        owner = owner_;
        guardians = guardians_;
        rpIdHash = rpIdHash_;
        origin = origin_;
        budgets[token].limit = dailyLimit;
        _trustedEpoch[owner_] = epoch;
    }
    receive() external payable {}
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function isGuardian(address who) public view returns (bool) {
        return who == guardians[0] || who == guardians[1] || who == guardians[2];
    }

    function trusted(address who) public view returns (bool) {
        return _trustedEpoch[who] == epoch;
    }

    function deviceIds() external view returns (bytes32[] memory) {
        return _deviceIds;
    }

    function remaining(address token) public view returns (uint256) {
        Budget memory b = budgets[token];
        return block.timestamp >= b.resetAt ? b.limit : b.limit > b.spent ? b.limit - b.spent : 0;
    }

    function addDevice(bytes32 id, bytes32 x, bytes32 y, uint64 expiresAt) external onlyOwner {
        if (
            id == 0 || (devices[id].x != 0 && devices[id].epoch == epoch) || _deviceIds.length >= 64
                || !P256.isValidPublicKey(x, y) || expiresAt <= block.timestamp
                || expiresAt > block.timestamp + 365 days
        ) revert Invalid();
        devices[id] = Device(x, y, expiresAt, epoch, true);
        _deviceIds.push(id);
        emit DeviceAdded(id, expiresAt, epoch);
    }

    function revokeDevice(bytes32 id) external {
        if (msg.sender != owner && !isGuardian(msg.sender)) revert Unauthorized();
        devices[id].enabled = false;
        emit DeviceRevoked(id);
    }

    /// @dev action 0: immediate transfer, 1: queue transfer, 2: claim allowance,
    /// 3: withdraw graduated sprout into THIS wallet. The last two never send
    /// directly to an external recipient. A device cannot change recovery policy.
    function act(uint8 action, address target, address token, uint256 amount) external onlyOwner nonReentrant {
        _act(action, target, token, amount);
    }

    function challenge(uint8 action, address target, address token, uint256 amount, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(VERSION, block.chainid, address(this), epoch, nonce, action, target, token, amount, deadline)
        );
    }

    function actWithPasskey(
        uint8 action,
        address target,
        address token,
        uint256 amount,
        uint64 deadline,
        bytes32 deviceId,
        GuardianWebAuthn.Assertion calldata assertion
    ) external nonReentrant {
        Device memory d = devices[deviceId];
        if (!d.enabled || d.epoch != epoch || d.expiresAt <= block.timestamp) revert Unauthorized();
        if (deadline < block.timestamp || deadline > block.timestamp + 10 minutes) revert Expired();
        if (!GuardianWebAuthn.verify(
                challenge(action, target, token, amount, deadline), assertion, d.x, d.y, rpIdHash, origin
            )) revert Unauthorized();
        ++nonce;
        _act(action, target, token, amount);
    }

    function _act(uint8 action, address target, address token, uint256 amount) private {
        if (target == address(0) || target == address(this) || amount == 0) revert Invalid();
        if (action == 0) {
            if (!trusted(target) || amount > remaining(token)) revert UseQueue();
            Budget storage b = budgets[token];
            if (block.timestamp >= b.resetAt) {
                b.spent = 0;
                b.resetAt = uint64(block.timestamp + 1 days);
            }
            b.spent += amount;
            _send(token, target, amount);
        } else if (action == 1) {
            uint256 id = ++transferCount;
            uint64 ready = uint64(block.timestamp + TRANSFER_DELAY);
            transfers[id] = Transfer(token, target, amount, ready, epoch, false);
            emit TransferQueued(id, token, target, amount, ready);
        } else if (action == 2 || action == 3) {
            if (IGuardianSprout(target).beneficiary() != address(this)) revert Invalid();
            if (action == 2) IGuardianSprout(target).claimAllowance(token, amount);
            else IGuardianSprout(target).withdraw(token, amount, address(this));
        } else {
            revert Invalid();
        }
    }

    function executeTransfer(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        if (t.readyAt == 0 || t.closed || t.epoch != epoch) revert Invalid();
        if (block.timestamp < t.readyAt) revert NotReady();
        if (block.timestamp > t.readyAt + REQUEST_LIFETIME) revert Expired();
        t.closed = true;
        _send(t.token, t.to, t.amount);
        emit TransferClosed(id, true);
    }

    function cancelTransfer(uint256 id) external {
        if (msg.sender != owner && !isGuardian(msg.sender)) revert Unauthorized();
        transfers[id].closed = true;
        emit TransferClosed(id, false);
    }

    function _send(address token, address to, uint256 amount) private {
        if (!recovery.closed && recovery.approvals >= 2 && block.timestamp <= recovery.expiresAt) {
            revert RecoveryPending();
        }
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert Invalid();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Transferred(token, to, amount);
    }

    function startRecovery(address newOwner) external {
        if (!isGuardian(msg.sender)) revert Unauthorized();
        if (!recovery.closed && recovery.expiresAt >= block.timestamp && recovery.expiresAt != 0) revert Invalid();
        _validateGuardians(newOwner, guardians);
        if (newOwner == owner) revert Invalid();
        ++recoveryId;
        recovery = Recovery(newOwner, 0, uint64(block.timestamp + REQUEST_LIFETIME), 0, false);
        emit RecoveryStarted(recoveryId, newOwner);
        _approveRecovery();
    }

    function approveRecovery(uint256 id) external {
        if (id != recoveryId) revert Invalid();
        _approveRecovery();
    }

    function _approveRecovery() private {
        if (!isGuardian(msg.sender) || recoveryApproved[recoveryId][msg.sender]) revert Unauthorized();
        if (recovery.closed || recovery.expiresAt < block.timestamp || recovery.expiresAt == 0) revert Expired();
        recoveryApproved[recoveryId][msg.sender] = true;
        ++recovery.approvals;
        if (recovery.approvals == 2) {
            recovery.readyAt = uint64(block.timestamp + RECOVERY_DELAY);
            recovery.expiresAt = uint64(block.timestamp + RECOVERY_DELAY + REQUEST_LIFETIME);
        }
        emit RecoveryApproved(recoveryId, msg.sender, recovery.approvals, recovery.readyAt);
    }

    function cancelRecovery() external onlyOwner {
        recovery.closed = true;
        emit RecoveryClosed(recoveryId, false);
    }

    function executeRecovery(uint256 id) external {
        if (id != recoveryId || recovery.closed || recovery.approvals < 2) revert Invalid();
        if (block.timestamp < recovery.readyAt) revert NotReady();
        if (block.timestamp > recovery.expiresAt) revert Expired();
        owner = recovery.newOwner;
        recovery.closed = true;
        ++epoch;
        ++nonce;
        delete _deviceIds;
        _trustedEpoch[owner] = epoch;
        pendingPolicy = 0;
        policyReadyAt = 0;
        emit RecoveryClosed(id, true);
    }

    /// @notice Owner may immediately tighten limits or remove a trusted destination.
    function tighten(address token, uint256 limit, address untrust) external onlyOwner {
        if (limit > budgets[token].limit) revert Invalid();
        budgets[token].limit = limit;
        _trustedEpoch[untrust] = 0;
    }

    /// @notice A single explicit policy change: token budget, trusted destination,
    /// and guardian choices. Owner must execute it after 48h; old guardians can veto.
    function policyHash(address token, uint256 limit, address destination, address[3] memory nextGuardians)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(epoch, token, limit, destination, nextGuardians));
    }

    function queuePolicy(address token, uint256 limit, address destination, address[3] calldata nextGuardians)
        external
        onlyOwner
    {
        _validateGuardians(owner, nextGuardians);
        if (destination == address(this)) revert Invalid();
        pendingPolicy = policyHash(token, limit, destination, nextGuardians);
        policyReadyAt = uint64(block.timestamp + RECOVERY_DELAY);
        emit PolicyQueued(pendingPolicy, policyReadyAt);
    }

    function cancelPolicy() external {
        if (msg.sender != owner && !isGuardian(msg.sender)) revert Unauthorized();
        emit PolicyCancelled(pendingPolicy);
        pendingPolicy = 0;
        policyReadyAt = 0;
    }

    function executePolicy(address token, uint256 limit, address destination, address[3] calldata nextGuardians)
        external
        onlyOwner
    {
        bytes32 hash = policyHash(token, limit, destination, nextGuardians);
        if (hash != pendingPolicy || pendingPolicy == 0) revert Invalid();
        if (block.timestamp < policyReadyAt) revert NotReady();
        if (block.timestamp > policyReadyAt + REQUEST_LIFETIME) revert Expired();
        _validateGuardians(owner, nextGuardians);
        bool changed = keccak256(abi.encode(guardians)) != keccak256(abi.encode(nextGuardians));
        guardians = nextGuardians;
        budgets[token].limit = limit;
        if (destination != address(0)) _trustedEpoch[destination] = epoch;
        pendingPolicy = 0;
        policyReadyAt = 0;
        if (changed) {
            recovery.closed = true;
            ++recoveryId;
        }
        emit PolicyApplied(hash);
    }

    function _validateGuardians(address who, address[3] memory list) private view {
        if (who == address(0) || who == address(this)) revert Invalid();
        for (uint256 i; i < 3; ++i) {
            if (list[i] == address(0) || list[i] == address(this) || list[i] == who) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (list[i] == list[j]) revert Invalid();
            }
        }
    }
}
