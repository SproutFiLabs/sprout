// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {SproutVault} from "../SproutVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {MatchVault} from "./MatchVault.sol";

interface ITreasuryPolicy {
    function permitted(address vault) external view returns (bool);
    function updatedAt() external view returns (uint64);
    function maxAge() external view returns (uint64);
}

/// Opt-in implementation for newly created sprouts. Existing vaults are unchanged.
/// Treasury and matching contracts are immutable across all clones of this implementation.
contract SproutV3Vault is SproutVault {
    using SafeERC20 for IERC20;
    address public immutable matchVault;
    address public immutable treasury;
    address public immutable treasuryPolicy;
    bool public cashEnabled;
    uint256 public contributionCount;
    uint256 public continuityReserve;
    address public successor;
    address public coGuardian;
    bytes32 public planHash;
    uint64 public heartbeatAt;
    uint64 public cadence;
    uint64 public grace;
    uint64 public claimAt;
    uint64 public earlyGraduation;
    uint64 public reservePeriod;
    uint64 public reserveNext;
    uint256 public reserveInstallment;
    bool public continuityActive;
    uint256 public planEpoch;
    event Contribution(uint256 indexed id, address indexed from, uint256 amount);
    event CashPolicy(bool enabled);
    event CashParked(uint256 assets, uint256 shares);
    event CashReleased(uint256 assets, uint256 shares);
    event PlanWritten(bytes32 indexed hash, address successor, uint64 cadence, uint64 grace, uint256 epoch);
    event Heartbeat(uint64 at);
    event ContinuityArmed(uint64 readyAt, uint256 epoch);
    event ContinuityActivated(address successor, uint256 epoch);
    event PlanRevoked(uint256 epoch);
    event ReserveFunded(uint256 amount);
    event ReserveReleased(uint256 amount);
    error Unavailable();

    constructor(address matching, address treasury_, address policy_) {
        if (matching.code.length == 0) revert BadArguments();
        if ((treasury_ == address(0)) != (policy_ == address(0))) revert BadArguments();
        matchVault = matching;
        treasury = treasury_;
        treasuryPolicy = policy_;
    }
    modifier onlyParent() override {
        if (msg.sender != parent && !(continuityActive && msg.sender == successor)) revert NotParent();
        if (graduated()) revert Graduated();
        if (msg.sender == parent) {
            heartbeatAt = uint64(block.timestamp);
            claimAt = 0;
            continuityActive = false;
        }
        _;
    }
    modifier originalParent() {
        if (msg.sender != parent) revert NotParent();
        _;
    }

    function graduated() public view override returns (bool) {
        return super.graduated() || (continuityActive && earlyGraduation != 0 && block.timestamp >= earlyGraduation);
    }

    function _afterContribution(address from, address token, uint256 amount) internal override {
        if (token == settlementToken && from == parent && !graduated()) {
            ++contributionCount;
            emit Contribution(contributionCount, from, amount);
            MatchVault(matchVault).onContribution(from, amount, contributionCount);
            heartbeatAt = uint64(block.timestamp);
            claimAt = 0;
            continuityActive = false;
        }
    }

    function availableSettlement() public view override returns (uint256) {
        uint256 a = super.availableSettlement();
        return a > continuityReserve ? a - continuityReserve : 0;
    }

    function _tokenAvailableForCommit(address token) internal view override returns (uint256) {
        uint256 b = super._tokenAvailableForCommit(token);
        return token == settlementToken ? (b > continuityReserve ? b - continuityReserve : 0) : b;
    }

    function _beforeInvestment(uint256 spend) internal override {
        uint256 available = availableSettlement();
        if (spend > available && continuityActive && continuityReserve > 0 && block.timestamp >= reserveNext) {
            uint256 release = spend - available;
            if (release > reserveInstallment) release = reserveInstallment;
            if (release > continuityReserve) release = continuityReserve;
            continuityReserve -= release;
            reserveNext = uint64(block.timestamp) + reservePeriod;
            emit ReserveReleased(release);
        }
        available = availableSettlement();
        if (spend > available && treasury != address(0) && IERC20(treasury).balanceOf(address(this)) > 0) {
            _unpark(spend - available);
        }
    }

    function setCashEnabled(bool enabled) external onlyParent {
        if (enabled) {
            _treasuryReady();
            if (IERC4626(treasury).asset() != settlementToken) revert UnsupportedToken();
        }
        cashEnabled = enabled;
        emit CashPolicy(enabled);
    }

    function _treasuryReady() internal view {
        if (treasury == address(0) || treasuryPolicy == address(0)) revert Unavailable();
        ITreasuryPolicy p = ITreasuryPolicy(treasuryPolicy);
        uint64 at = p.updatedAt();
        if (!p.permitted(address(this)) || at > block.timestamp || block.timestamp - at > p.maxAge()) revert Unavailable();
    }

    function parkCash(uint256 assets, uint256 minShares) external nonReentrant notGraduated {
        if (!cashEnabled || assets == 0 || assets > availableSettlement() || minShares == 0) revert BadArguments();
        _treasuryReady();
        uint256 quoted = IERC4626(treasury).previewDeposit(assets);
        if (minShares < quoted * (BPS_DENOMINATOR - maxSlippageBps) / BPS_DENOMINATOR) revert BadArguments();
        uint256 before = IERC20(treasury).balanceOf(address(this));
        IERC20(settlementToken).forceApprove(treasury, assets);
        IERC4626(treasury).deposit(assets, address(this));
        IERC20(settlementToken).forceApprove(treasury, 0);
        uint256 shares = IERC20(treasury).balanceOf(address(this)) - before;
        if (shares < minShares) revert Shortfall();
        emit CashParked(assets, shares);
    }

    function unparkCash(uint256 assets) external nonReentrant {
        if (
            msg.sender != parent && !(continuityActive && msg.sender == successor)
                && !(graduated() && msg.sender == beneficiary)
        ) {
            revert NotParent();
        }
        _unpark(assets);
    }

    function _unpark(uint256 assets) internal {
        if (treasury == address(0) || assets == 0) revert Unavailable();
        // Redemptions always return to this vault. No stale quote is used to size an arbitrary swap.
        uint256 before = IERC20(settlementToken).balanceOf(address(this));
        uint256 shares = IERC4626(treasury).withdraw(assets, address(this), address(this));
        if (IERC20(settlementToken).balanceOf(address(this)) - before != assets) revert Shortfall();
        emit CashReleased(assets, shares);
    }

    function writePlan(
        address successor_,
        address coGuardian_,
        uint64 cadence_,
        uint64 grace_,
        uint64 early_,
        bytes32 hash_,
        uint256 installment,
        uint64 period
    ) external originalParent {
        if (
            graduated() || successor_ == address(0) || successor_ == parent || successor_ == beneficiary
                || coGuardian_ == parent || coGuardian_ == successor_ || hash_ == bytes32(0)
        ) revert BadArguments();
        if (
            cadence_ < 7 days || cadence_ > 366 days || grace_ < 2 days || grace_ > 90 days || period < 7 days
                || period > 366 days
        ) {
            revert BadArguments();
        }
        if (early_ != 0 && (early_ <= block.timestamp + cadence_ + grace_ || early_ >= graduationTimestamp)) revert BadArguments();
        successor = successor_;
        coGuardian = coGuardian_;
        cadence = cadence_;
        grace = grace_;
        earlyGraduation = early_;
        planHash = hash_;
        reserveInstallment = installment;
        reservePeriod = period;
        reserveNext = 0;
        heartbeatAt = uint64(block.timestamp);
        claimAt = 0;
        continuityActive = false;
        ++planEpoch;
        emit PlanWritten(hash_, successor_, cadence_, grace_, planEpoch);
    }

    function checkIn() external originalParent {
        if (graduated()) revert Graduated();
        heartbeatAt = uint64(block.timestamp);
        claimAt = 0;
        continuityActive = false;
        emit Heartbeat(heartbeatAt);
    }

    function cancelClaim() external {
        if (graduated()) revert Graduated();
        if (msg.sender != parent && msg.sender != coGuardian) revert NotParent();
        heartbeatAt = uint64(block.timestamp);
        claimAt = 0;
        continuityActive = false;
        emit Heartbeat(heartbeatAt);
    }

    function revokePlan() external originalParent {
        if (graduated()) revert Graduated();
        planHash = 0;
        successor = address(0);
        claimAt = 0;
        continuityActive = false;
        earlyGraduation = 0;
        ++planEpoch;
        emit PlanRevoked(planEpoch);
    }

    function armContinuity() external {
        if (
            planHash == 0 || msg.sender != successor || continuityActive || claimAt != 0
                || block.timestamp < heartbeatAt + cadence || graduated()
        ) revert BadArguments();
        claimAt = uint64(block.timestamp) + grace;
        emit ContinuityArmed(claimAt, planEpoch);
    }

    function activateContinuity(uint256 epoch) external {
        if (
            epoch != planEpoch || msg.sender != successor || claimAt == 0 || block.timestamp < claimAt
                || continuityActive || planHash == 0 || super.graduated()
        ) revert BadArguments();
        continuityActive = true;
        claimAt = 0;
        emit ContinuityActivated(successor, epoch);
    }

    function fundReserve(uint256 amount) external originalParent nonReentrant {
        if (planHash == 0 || amount == 0 || graduated()) revert BadArguments();
        uint256 before = IERC20(settlementToken).balanceOf(address(this));
        IERC20(settlementToken).safeTransferFrom(parent, address(this), amount);
        if (IERC20(settlementToken).balanceOf(address(this)) - before != amount) revert Shortfall();
        continuityReserve += amount;
        emit ReserveFunded(amount);
    }

    function refundReserve(uint256 amount) external originalParent nonReentrant {
        if (continuityActive || claimAt != 0 || amount == 0 || amount > continuityReserve || graduated()) revert BadArguments();
        continuityReserve -= amount;
        IERC20(settlementToken).safeTransfer(parent, amount);
    }
}
