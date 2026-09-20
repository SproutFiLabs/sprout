// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISproutAdmission} from "./interfaces/ISproutAdmission.sol";
import {ISproutVenue} from "./interfaces/ISproutVenue.sol";

/// @title SproutVault
/// @notice Custody and policy for one child's savings sprout. Created as a
///         minimal proxy by {SproutFactory}. The parent controls funding,
///         allocation, scheduling and milestones until an immutable graduation
///         timestamp; afterwards the beneficiary has full control.
///
/// @dev Custody boundary: the parent may choose only among assets and venues
///      admitted by the factory's immutable policy. The vault never trusts a
///      venue, token, or user-supplied calldata blindly: every execution checks
///      the independently quoted floor, measures the actual output balance
///      delta, and clears the approval afterwards.
contract SproutVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ASSETS = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint64 public constant MIN_INVEST_PERIOD = 1 hours;
    uint256 public constant MAX_SLIPPAGE_BPS = 1_000;

    address public factory;
    address public parent;
    address public beneficiary;
    uint64 public graduationTimestamp;
    address public settlementToken;

    address[] private _assets;
    uint16[] private _weights;
    mapping(address => bool) public isAllowedAsset;
    mapping(address => bool) public venueAllowed;

    uint256 public maxSlippageBps;

    /// @notice Token amounts unlocked for the beneficiary allowance bucket.
    mapping(address => uint256) public allowanceBucket;
    /// @notice Token amounts reserved by milestones that have not been released.
    mapping(address => uint256) public totalEarmarked;

    struct Milestone {
        address token;
        uint256 amount;
        uint64 unlockTime;
        bool released;
        bool cancelled;
    }

    mapping(bytes32 => Milestone) public milestones;

    bool public scheduleActive;
    uint256 public investAmount;
    uint64 public investPeriod;
    uint64 public nextExecution;

    event SproutInitialized(
        address indexed parent,
        address indexed beneficiary,
        address settlementToken,
        address factory,
        uint64 graduationTimestamp
    );
    event Funded(address indexed from, address indexed token, uint256 amount);
    event AllocationUpdated(address[] assets, uint16[] weights);
    event VenueUpdated(address indexed venue, bool allowed);
    event MaxSlippageUpdated(uint256 bps);
    event InvestmentScheduled(uint256 amount, uint64 period, uint64 nextExecution);
    event InvestmentCancelled();
    event InvestmentExecuted(address indexed token, uint256 amountIn, uint256 amountOut);
    event GiftReceived(address indexed gifter, address indexed token, uint256 amount, bytes32 indexed giftRef);
    event MilestoneCreated(bytes32 indexed id, address indexed token, uint256 amount, uint64 unlockTime);
    event MilestoneReleased(bytes32 indexed id, address indexed token, uint256 amount);
    event MilestoneCancelled(bytes32 indexed id);
    event AllowanceClaimed(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);

    error NotParent();
    error NotBeneficiary();
    error Graduated();
    error NotGraduated();
    error UnsupportedToken();
    error UnsupportedVenue();
    error BadArguments();
    error NotDue();
    error VenueNotAllowed();
    error Overcommitted();
    error AlreadyDone();
    error NothingClaimable();
    error ExceedsAllowance();
    error Shortfall();

    constructor() {
        _disableInitializers();
    }

    modifier notGraduated() {
        if (graduated()) revert Graduated();
        _;
    }

    modifier onlyParent() virtual {
        if (msg.sender != parent) revert NotParent();
        if (graduated()) revert Graduated();
        _;
    }

    // ---------------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------------

    /// @dev Only the factory that clones this vault may initialize it, and every
    ///      asset/venue must already be admitted by that factory.
    function initialize(
        address factory_,
        address parent_,
        address beneficiary_,
        address settlementToken_,
        address[] calldata assets_,
        uint16[] calldata weights_,
        uint64 graduationTimestamp_,
        address[] calldata venues_
    ) external initializer {
        if (factory_ != msg.sender) revert BadArguments();
        if (parent_ == address(0) || beneficiary_ == address(0) || settlementToken_ == address(0)) {
            revert BadArguments();
        }
        if (ISproutAdmission(factory_).settlementToken() != settlementToken_) revert UnsupportedToken();
        if (graduationTimestamp_ <= block.timestamp) revert BadArguments();
        if (assets_.length == 0 || assets_.length > MAX_ASSETS) revert BadArguments();
        if (assets_.length != weights_.length) revert BadArguments();

        uint256 total;
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            if (asset == address(0) || asset == settlementToken_ || isAllowedAsset[asset]) revert BadArguments();
            if (!ISproutAdmission(factory_).isAdmittedAsset(asset)) revert UnsupportedToken();
            isAllowedAsset[asset] = true;
            _assets.push(asset);
            uint16 weight = weights_[i];
            total += weight;
            _weights.push(weight);
        }
        if (total != BPS_DENOMINATOR) revert BadArguments();

        for (uint256 i = 0; i < venues_.length; i++) {
            address venue = venues_[i];
            if (venue == address(0) || venueAllowed[venue]) revert BadArguments();
            if (!ISproutAdmission(factory_).isAdmittedVenue(venue)) revert UnsupportedVenue();
            venueAllowed[venue] = true;
        }

        factory = factory_;
        parent = parent_;
        beneficiary = beneficiary_;
        settlementToken = settlementToken_;
        graduationTimestamp = graduationTimestamp_;
        maxSlippageBps = 100;

        emit SproutInitialized(parent_, beneficiary_, settlementToken_, factory_, graduationTimestamp_);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function _tokenAvailableForCommit(address token) internal view virtual returns(uint256) { return IERC20(token).balanceOf(address(this)); }
    function _afterContribution(address, address, uint256) internal virtual {}
    function _beforeInvestment(uint256) internal virtual {}

    function graduated() public view virtual returns (bool) {
        return block.timestamp >= graduationTimestamp;
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function weights() external view returns (uint16[] memory) {
        return _weights;
    }

    function allocation() external view returns (address[] memory, uint16[] memory) {
        return (_assets, _weights);
    }

    function schedule()
        external
        view
        returns (bool active, uint256 amount, uint64 period, uint64 nextExecution_, uint256 maxSlippage)
    {
        return (scheduleActive, investAmount, investPeriod, nextExecution, maxSlippageBps);
    }

    function availableSettlement() public view virtual returns (uint256) {
        uint256 balance = IERC20(settlementToken).balanceOf(address(this));
        uint256 committed = allowanceBucket[settlementToken] + totalEarmarked[settlementToken];
        return balance > committed ? balance - committed : 0;
    }

    // ---------------------------------------------------------------------
    // Funding / policy
    // ---------------------------------------------------------------------

    /// @notice Anyone may add value; the parent cannot remove it.
    function fund(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert BadArguments();
        if (token != settlementToken && !isAllowedAsset[token]) revert UnsupportedToken();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount);
        _afterContribution(msg.sender, token, amount);
    }

    /// @notice Replace the allocation. Only factory-admitted assets are allowed.
    function updateAllocation(address[] calldata newAssets, uint16[] calldata newWeights)
        external
        onlyParent
    {
        if (newAssets.length == 0 || newAssets.length > MAX_ASSETS) revert BadArguments();
        if (newAssets.length != newWeights.length) revert BadArguments();

        for (uint256 i = 0; i < _assets.length; i++) {
            isAllowedAsset[_assets[i]] = false;
        }
        delete _assets;

        uint256 total;
        for (uint256 i = 0; i < newAssets.length; i++) {
            address asset = newAssets[i];
            if (asset == address(0) || asset == settlementToken || isAllowedAsset[asset]) revert BadArguments();
            if (!ISproutAdmission(factory).isAdmittedAsset(asset)) revert UnsupportedToken();
            isAllowedAsset[asset] = true;
            _assets.push(asset);
            total += newWeights[i];
        }
        if (total != BPS_DENOMINATOR) revert BadArguments();
        delete _weights;
        for (uint256 i = 0; i < newWeights.length; i++) {
            _weights.push(newWeights[i]);
        }
        emit AllocationUpdated(newAssets, newWeights);
    }

    /// @notice Toggle a venue. Only factory-admitted venues may be enabled.
    function setVenueAllowed(address venue, bool allowed) external onlyParent {
        if (venue == address(0)) revert BadArguments();
        if (allowed && !ISproutAdmission(factory).isAdmittedVenue(venue)) revert UnsupportedVenue();
        venueAllowed[venue] = allowed;
        emit VenueUpdated(venue, allowed);
    }

    function setMaxSlippage(uint256 bps) external onlyParent {
        if (bps > MAX_SLIPPAGE_BPS) revert BadArguments();
        maxSlippageBps = bps;
        emit MaxSlippageUpdated(bps);
    }

    // ---------------------------------------------------------------------
    // Scheduling and bounded execution
    // ---------------------------------------------------------------------

    function scheduleInvestment(uint256 amount, uint64 period, uint64 firstExecution) external onlyParent {
        if (amount == 0 || period < MIN_INVEST_PERIOD) revert BadArguments();
        investAmount = amount;
        investPeriod = period;
        nextExecution = firstExecution == 0 ? uint64(block.timestamp) : firstExecution;
        scheduleActive = true;
        emit InvestmentScheduled(amount, period, nextExecution);
    }

    function cancelInvestment() external onlyParent {
        scheduleActive = false;
        emit InvestmentCancelled();
    }

    /// @notice Execute at most one currently-due purchase, then schedule forward.
    /// @dev Any keeper may call. Missed periods are not silently drained: at most
    ///      one purchase happens per call and the next due time jumps forward.
    ///      The venue must be admitted; the floor is derived from the vetted
    ///      adapter's independent oracle quote; the actual received amount is the
    ///      measured balance delta, not the value the venue reports; approvals are
    ///      cleared after each leg.
    function executeInvestment(address venue, uint256[] calldata minOuts)
        external
        nonReentrant
        notGraduated
        returns (uint256[] memory amountsOut)
    {
        if (!scheduleActive) revert BadArguments();
        if (block.timestamp < nextExecution) revert NotDue();
        if (!venueAllowed[venue] || !ISproutAdmission(factory).isAdmittedVenue(venue)) revert VenueNotAllowed();
        uint256 spend = investAmount;
        _beforeInvestment(spend);
        if (spend > availableSettlement()) revert Overcommitted();
        if (minOuts.length != _assets.length) revert BadArguments();

        // Advance exactly one period and skip missed installments forward.
        uint64 advanced = nextExecution + investPeriod;
        if (advanced <= block.timestamp) {
            advanced = uint64(block.timestamp) + investPeriod;
        }
        nextExecution = advanced;

        amountsOut = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 amountIn = (spend * _weights[i]) / BPS_DENOMINATOR;
            if (amountIn == 0) continue;

            uint256 expected = ISproutVenue(venue).quote(settlementToken, _assets[i], amountIn);
            if (expected == 0) revert Shortfall();
            uint256 floor = (expected * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;
            if (minOuts[i] < floor) revert BadArguments();

            IERC20 outToken = IERC20(_assets[i]);
            uint256 before = outToken.balanceOf(address(this));

            IERC20(settlementToken).forceApprove(venue, amountIn);
            ISproutVenue(venue).swap(settlementToken, _assets[i], amountIn, minOuts[i], address(this));
            // Never leave a residual allowance behind.
            IERC20(settlementToken).forceApprove(venue, 0);

            uint256 received = outToken.balanceOf(address(this)) - before;
            if (received < minOuts[i]) revert Shortfall();
            amountsOut[i] = received;
            emit InvestmentExecuted(_assets[i], amountIn, received);
        }
    }

    // ---------------------------------------------------------------------
    // Gift links
    // ---------------------------------------------------------------------

    /// @notice Public gift payment into a fixed vault. Reusable by design.
    function payGift(address token, uint256 amount, bytes32 giftRef) external nonReentrant {
        if (amount == 0) revert BadArguments();
        if (token != settlementToken && !isAllowedAsset[token]) revert UnsupportedToken();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit GiftReceived(msg.sender, token, amount, giftRef);
        _afterContribution(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------------
    // Allowance milestones
    // ---------------------------------------------------------------------

    function createMilestone(bytes32 id, address token, uint256 amount, uint64 unlockTime) external onlyParent {
        if (id == bytes32(0) || amount == 0) revert BadArguments();
        if (token != settlementToken && !isAllowedAsset[token]) revert UnsupportedToken();
        if (milestones[id].token != address(0)) revert AlreadyDone();

        uint256 balance = _tokenAvailableForCommit(token);
        uint256 committed = allowanceBucket[token] + totalEarmarked[token];
        if (committed + amount > balance) revert Overcommitted();

        totalEarmarked[token] += amount;
        milestones[id] = Milestone({token: token, amount: amount, unlockTime: unlockTime, released: false, cancelled: false});
        emit MilestoneCreated(id, token, amount, unlockTime);
    }

    function releaseMilestone(bytes32 id) external onlyParent {
        Milestone storage m = milestones[id];
        if (m.token == address(0)) revert BadArguments();
        if (m.released || m.cancelled) revert AlreadyDone();
        if (m.unlockTime != 0 && block.timestamp < m.unlockTime) revert NotDue();
        m.released = true;
        totalEarmarked[m.token] -= m.amount;
        allowanceBucket[m.token] += m.amount;
        emit MilestoneReleased(id, m.token, m.amount);
    }

    function cancelMilestone(bytes32 id) external onlyParent {
        Milestone storage m = milestones[id];
        if (m.token == address(0)) revert BadArguments();
        if (m.released || m.cancelled) revert AlreadyDone();
        m.cancelled = true;
        totalEarmarked[m.token] -= m.amount;
        emit MilestoneCancelled(id);
    }

    /// @notice Beneficiary claims unlocked allowance. Decrements the bucket so a
    ///         release/claim cannot be replayed.
    function claimAllowance(address token, uint256 amount) external nonReentrant {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (amount == 0) revert BadArguments();
        uint256 available = allowanceBucket[token];
        if (available == 0) revert NothingClaimable();
        if (amount > available) revert ExceedsAllowance();
        allowanceBucket[token] = available - amount;
        IERC20(token).safeTransfer(beneficiary, amount);
        emit AllowanceClaimed(token, amount);
    }

    // ---------------------------------------------------------------------
    // Graduation
    // ---------------------------------------------------------------------

    /// @notice After graduation the beneficiary has full control. Parent powers
    ///         have already stopped because they are timestamp-gated.
    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        if (!graduated()) revert NotGraduated();
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (to == address(0) || amount == 0) revert BadArguments();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
    }
}
