// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";
//import "./interfaces/IBounceStake.sol";

contract BounceDutchAuction is Configurable, ReentrancyGuardUpgradeSafe {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    bytes32 internal constant TxFeeRatio =              bytes32("DAV2P::TxFeeRatio");
    bytes32 internal constant MinValueOfBotHolder =     bytes32("DAV2P::MinValueOfBotHolder");
    bytes32 internal constant BotToken =                bytes32("DAV2P::BotToken");
    bytes32 internal constant StakeContract =           bytes32("DAV2P::StakeContract");

    struct CreateReq {
        // creator of the pool
        address payable creator;
        // address of sell token
        address token0;
        // address of buy token
        address token1;
        // total amount of token0
        uint amountTotal0;
        // maximum amount of ETH that creator want to swap
        uint amountMax1;
        // minimum amount of ETH that creator want to swap
        uint amountMin1;
        // how many times a bid will decrease it's price
        uint times;
        // the duration in seconds the pool will be closed
        uint duration;
        // the timestamp in seconds the pool will open
        uint openAt;
        bool onlyBot;
    }

    struct Pool {
        // creator of the pool
        address payable creator;
        // address of sell token
        address token0;
        // address of buy token
        address token1;
        // total amount of sell token
        uint amountTotal0;
        // maximum amount of ETH that creator want to swap
        uint amountMax1;
        // minimum amount of ETH that creator want to swap
        uint amountMin1;
        // how many times a bid will decrease it's price
        uint times;
        // the duration in seconds the pool will be closed
        uint duration;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
    }

    Pool[] public pools;

    // pool index => amount of sell token has been swap
    mapping(uint => uint) public amountSwap0P;
    // pool index => amount of ETH has been swap
    mapping(uint => uint) public amountSwap1P;
    // pool index => a flag that if creator is claimed the pool
    mapping(uint => bool) public creatorClaimedP;
    // pool index => the swap pool only allow BOT holder to take part in
    mapping(uint => bool) public onlyBotHolderP;

    mapping(uint => uint) public lowestBidPrice;
    // bidder address => pool index => whether or not bidder claimed
    mapping(address => mapping(uint => bool)) public bidderClaimedP;
    // bidder address => pool index => swapped amount of token0
    mapping(address => mapping(uint => uint)) public myAmountSwap0P;
    // bidder address => pool index => swapped amount of token1
    mapping(address => mapping(uint => uint)) public myAmountSwap1P;

    // creator address => pool index + 1. if the result is 0, the account don't create any pool.
    mapping(address => uint) public myCreatedP;

    bool public enableWhiteList;
    // pool index => account => whether or not allow swap
    mapping(uint => mapping(address => bool)) public whitelistP;

    event Created(uint indexed index, address indexed sender, Pool pool);
    event Bid(uint indexed index, address indexed sender, uint amount0, uint amount1);
    event Claimed(uint indexed index, address indexed sender, uint unFilledAmount0);

    function initialize() public initializer {
        super.__Ownable_init();
        super.__ReentrancyGuard_init();

        config[TxFeeRatio] = 0.02 ether;
        config[MinValueOfBotHolder] = 0.5 ether;
        config[BotToken] = uint(0xA9B1Eb5908CfC3cdf91F9B8B3a74108598009096);
        config[StakeContract] = uint(0x98945BC69A554F8b129b09aC8AfDc2cc2431c48E);
    }

    function initialize_rinkeby() public {
        initialize();

        config[BotToken] = uint(0x5E26FA0FE067d28aae8aFf2fB85Ac2E693BD9EfA);
        config[StakeContract] = uint(0x98945BC69A554F8b129b09aC8AfDc2cc2431c48E);
    }

    function create(CreateReq memory poolReq, address[] memory whitelist_) public payable
        nonReentrant
        isPoolNotCreate(poolReq.creator)
    {
        require(poolReq.amountTotal0 != 0, "the value of amountTotal0 is zero");
        require(poolReq.amountMin1 != 0, "the value of amountMax1 is zero");
        require(poolReq.amountMax1 != 0, "the value of amountMin1 is zero");
        require(poolReq.amountMax1 > poolReq.amountMin1, "amountMax1 should larger than amountMin1");
        require(poolReq.duration != 0, "the value of duration is zero");
        require(poolReq.duration <= 7 days, "the value of duration is exceeded one week");
        require(poolReq.times != 0, "the value of times is zero");

        uint index = pools.length;

        // transfer amount of token0 to this contract
        IERC20  _token0 = IERC20(poolReq.token0);
        uint token0BalanceBefore = _token0.balanceOf(address(this));
        _token0.safeTransferFrom(poolReq.creator, address(this), poolReq.amountTotal0);
        require(
            _token0.balanceOf(address(this)).sub(token0BalanceBefore) == poolReq.amountTotal0,
            "not support deflationary token"
        );
        // reset allowance to 0
        _token0.safeApprove(address(this), 0);

        if (whitelist_.length > 0) {
            enableWhiteList = true;
            for (uint i = 0; i < whitelist_.length; i++) {
                whitelistP[index][whitelist_[i]] = true;
            }
        }

        // creator pool
        Pool memory pool;
        pool.creator = poolReq.creator;
        pool.token0 = poolReq.token0;
        pool.token1 = poolReq.token1;
        pool.amountTotal0 = poolReq.amountTotal0;
        pool.amountMax1 = poolReq.amountMax1;
        pool.amountMin1 = poolReq.amountMin1;
        pool.times = poolReq.times;
        pool.duration = poolReq.duration;
        pool.openAt = poolReq.openAt;
        pool.closeAt = poolReq.openAt.add(poolReq.duration);
        pools.push(pool);

        if (poolReq.onlyBot) {
            onlyBotHolderP[index] = poolReq.onlyBot;
        }

        myCreatedP[poolReq.creator] = pools.length;

        emit Created(index, msg.sender, pool);
    }

    function bid(
        // pool index
        uint index,
        // amount of token0 want to bid
        uint amount0,
        // amount of token1
        uint amount1
    ) external payable
        nonReentrant
        isPoolExist(index)
        checkBotHolder(index)
        isPoolNotClosed(index)
    {
        address payable sender = msg.sender;
        if (enableWhiteList) {
            require(whitelistP[index][sender], "sender not in whitelist");
        }
        Pool memory pool = pools[index];
        require(amount0 != 0, "the value of amount0 is zero");
        require(amount1 != 0, "the value of amount1 is zero");
        require(pool.amountTotal0 > amountSwap0P[index], "swap amount is zero");

        // calculate price
        uint curPrice = currentPrice(index);
        uint bidPrice = amount1.mul(1 ether).div(amount0);
        require(bidPrice >= curPrice, "the bid price is lower than the current price");

        if (lowestBidPrice[index] == 0 || lowestBidPrice[index] > bidPrice) {
            lowestBidPrice[index] = bidPrice;
        }

        address token1 = pool.token1;
        if (token1 == address(0)) {
            require(amount1 == msg.value, "invalid ETH amount");
        } else {
            IERC20(token1).safeTransferFrom(sender, address(this), amount1);
            IERC20(token1).safeApprove(address(this), 0);
        }

        _swap(sender, index, amount0, amount1);

        emit Bid(index, sender, amount0, amount1);
    }

    function creatorClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        address payable creator = msg.sender;
        require(isCreator(creator, index), "sender is not pool creator");
        require(!creatorClaimedP[index], "creator has claimed this pool");
        creatorClaimedP[index] = true;

        // remove ownership of this pool from creator
        delete myCreatedP[creator];

        // calculate un-filled amount0
        Pool memory pool = pools[index];
        uint unFilledAmount0 = pool.amountTotal0.sub(amountSwap0P[index]);
        if (unFilledAmount0 > 0) {
            // transfer un-filled amount of token0 back to creator
            IERC20(pool.token0).safeTransfer(creator, unFilledAmount0);
        }

        // send token1 to creator
        uint amount1 = lowestBidPrice[index].mul(amountSwap0P[index]).div(1 ether);
        if (amount1 > 0) {
            if (pool.token1 == address(0)) {
                uint256 txFee = amount1.mul(getTxFeeRatio()).div(1 ether);
                uint256 _actualAmount1 = amount1.sub(txFee);
                if (_actualAmount1 > 0) {
                    pool.creator.transfer(_actualAmount1);
                }
                if (txFee > 0) {
                    // deposit transaction fee to staking contract
//                    IBounceStake(getStakeContract()).depositReward{value: txFee}();
                }
            } else {
                IERC20(pool.token1).safeTransfer(pool.creator, amount1);
            }
        }

        emit Claimed(index, creator, unFilledAmount0);
    }

    function bidderClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        address payable bidder = msg.sender;
        require(!bidderClaimedP[bidder][index], "bidder has claimed this pool");
        bidderClaimedP[bidder][index] = true;

        Pool memory pool = pools[index];
        // send token0 to bidder
        if (myAmountSwap0P[bidder][index] > 0) {
            IERC20(pool.token0).safeTransfer(bidder, myAmountSwap0P[bidder][index]);
        }

        // send unfilled token1 to bidder
        uint actualAmount1 = lowestBidPrice[index].mul(myAmountSwap0P[bidder][index]).div(1 ether);
        uint unfilledAmount1 = myAmountSwap1P[bidder][index].sub(actualAmount1);
        if (unfilledAmount1 > 0) {
            if (pool.token1 == address(0)) {
                bidder.transfer(unfilledAmount1);
            } else {
                IERC20(pool.token1).safeTransfer(bidder, unfilledAmount1);
            }
        }
    }

    function _swap(address payable sender, uint index, uint amount0, uint amount1) private {
        Pool memory pool = pools[index];
        uint _amount0 = pool.amountTotal0.sub(amountSwap0P[index]);
        uint _amount1 = 0;
        uint _excessAmount1 = 0;

        // check if amount0 is exceeded
        if (_amount0 < amount0) {
            _amount1 = _amount0.mul(amount1).div(amount0);
            _excessAmount1 = amount1.sub(_amount1);
        } else {
            _amount0 = amount0;
            _amount1 = amount1;
        }
        myAmountSwap0P[sender][index] = myAmountSwap0P[sender][index].add(_amount0);
        myAmountSwap1P[sender][index] = myAmountSwap1P[sender][index].add(_amount1);
        amountSwap0P[index] = amountSwap0P[index].add(_amount0);
        amountSwap1P[index] = amountSwap1P[index].add(_amount1);

        // send excess amount of token1 back to sender
        if (_excessAmount1 > 0) {
            if (pool.token1 == address(0)) {
                sender.transfer(_excessAmount1);
            } else {
                IERC20(pool.token1).safeTransfer(sender, _excessAmount1);
            }
        }
    }

    function isCreator(address target, uint index) private view returns (bool) {
        if (pools[index].creator == target) {
            return true;
        }
        return false;
    }

    function currentPrice(uint index) public view returns (uint) {
        Pool memory pool = pools[index];
        uint _amount1 = pool.amountMin1;
        uint realTimes = pool.times.add(1);

        if (now < pool.closeAt) {
            uint stepInSeconds = pool.duration.div(realTimes);
            if (stepInSeconds != 0) {
                uint remainingTimes = pool.closeAt.sub(now).sub(1).div(stepInSeconds);
                if (remainingTimes != 0) {
                    _amount1 = pool.amountMax1.sub(pool.amountMin1)
                        .mul(remainingTimes).div(pool.times)
                        .add(pool.amountMin1);
                }
            }
        }

        return _amount1.mul(1 ether).div(pool.amountTotal0);
    }

    function nextRoundInSeconds(uint index) public view returns (uint) {
        Pool memory pool = pools[index];
        if (now >= pool.closeAt) return 0;
        uint realTimes = pool.times.add(1);
        uint stepInSeconds = pool.duration.div(realTimes);
        if (stepInSeconds == 0) return 0;
        uint remainingTimes = pool.closeAt.sub(now).sub(1).div(stepInSeconds);

        return pool.closeAt.sub(remainingTimes.mul(stepInSeconds)).sub(now);
    }

    function getPoolCount() public view returns (uint) {
        return pools.length;
    }

    function getTxFeeRatio() public view returns (uint) {
        return config[TxFeeRatio];
    }

    function getMinValueOfBotHolder() public view returns (uint) {
        return config[MinValueOfBotHolder];
    }

    function getBotToken() public view returns (address) {
        return address(config[BotToken]);
    }

    function getStakeContract() public view returns (address) {
        return address(config[StakeContract]);
    }

    modifier checkBotHolder(uint index) {
        if (onlyBotHolderP[index]) {
            require(IERC20(getBotToken()).balanceOf(msg.sender) >= getMinValueOfBotHolder(), "BOT is not enough");
        }
        _;
    }

    modifier isPoolClosed(uint index) {
        require(pools[index].closeAt <= now, "this pool is not closed");
        _;
    }

    modifier isPoolNotClosed(uint index) {
        require(pools[index].closeAt > now, "this pool is closed");
        _;
    }

    modifier isPoolNotCreate(address target) {
        if (myCreatedP[target] > 0) {
            revert("a pool has created by this address");
        }
        _;
    }

    modifier isPoolExist(uint index) {
        require(index < pools.length, "this pool does not exist");
        _;
    }
}
