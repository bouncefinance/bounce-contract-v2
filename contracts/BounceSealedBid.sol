// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/Address.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";
import "./interfaces/IBounceStake.sol";

contract BounceSealedBid is Configurable, ReentrancyGuardUpgradeSafe {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    bytes32 internal constant TxFeeRatio =              bytes32("TxFeeRatio");
    bytes32 internal constant MaxBidCount =             bytes32("MaxBidCount");
    bytes32 internal constant MinValueOfBotHolder =     bytes32("MinValueOfBotHolder");
    bytes32 internal constant BotToken =                bytes32("BotToken");
    bytes32 internal constant StakeContract  =          bytes32("StakeContract");

    struct CreateReq {
        // pool name
        string name;
        // creator of the pool
        address payable creator;
        // address of sell token
        address token0;
        // address of buy token
        address token1;
        // total amount of token0
        uint amountTotal0;
        // total amount of token1
        uint amountMin1;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
        bool onlyBot;
        uint maxAmount1PerWallet;
        // whether or not whitelist is enable
        bool enableWhiteList;
    }

    struct Pool {
        // pool name
        string name;
        // creator of the pool
        address payable creator;
        // address of token0
        address token0;
        // address of token1
        address token1;
        // total amount of token0
        uint amountTotal0;
        // minimum amount of token1
        uint amountMin1;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
        // whether or not whitelist is enable
        bool enableWhiteList;
    }

    Pool[] public pools;

    // pool index => a flat that if creator is claimed the pool
    mapping(uint => bool) public creatorClaimedP;
    // pool index => array of bid address
    mapping(uint => address[]) public bidderListP;
    // pool index => array of position of bid address sorted in decreasing order of bid price
    mapping(uint => uint[]) public bidderPositionListP;
    // pool index => position of bid list header
    mapping(uint => uint) public bidderListHeaderP;
    // pool index => bid count
    mapping(uint => uint) public bidCountP;
    // pool index => minimum bid amount, if the value is not set, the default value is zero
    mapping(uint => uint) public maxAmount1PerWallet;
    // pool index => the swap pool only allow BOT holder to take part in
    mapping(uint => bool) public onlyBotHolderP;

    // account => array of pool index
    mapping(address => uint[]) public myBidP;
    // account => pool index => bid amount of token0
    mapping(address => mapping(uint => uint)) public myAmountBid0P;
    // account => pool index => bid amount of token1
    mapping(address => mapping(uint => uint)) public myAmountBid1P;
    // account => pool index => bid price
    mapping(address => mapping(uint => uint)) public myPrice;
    // account => pool index => claim flag
    mapping(address => mapping(uint => bool)) public myClaimedP;
    // account => pool index + 1. if the result is 0, the account don't create any pool.
    mapping(address => uint) public myCreatedP;

    // pool index => account => whether or not allow swap
    mapping(uint => mapping(address => bool)) public whitelistP;

    event Created(uint indexed index, address indexed sender, Pool pool);
    event Bid(uint indexed index, address indexed sender, uint amount0, uint amount1);
    event CreatorClaimed(uint indexed index, address indexed sender, uint unFilledAmount0, uint actualAmount1);
    event BidClaimed(uint indexed index, address indexed sender, uint filledAmount0, uint unfilledAmount1);

    function initialize() public initializer {
        super.__Ownable_init();
        super.__ReentrancyGuard_init();

        config[TxFeeRatio] = 0.015 ether;
        config[MinValueOfBotHolder] = 60 ether;
        config[MaxBidCount] = 1000;

        // mainnet
        config[BotToken] = uint(0xA9B1Eb5908CfC3cdf91F9B8B3a74108598009096);
        config[StakeContract] = uint(0x98945BC69A554F8b129b09aC8AfDc2cc2431c48E);
    }

    function initialize_rinkeby() public {
        initialize();

        config[BotToken] = uint(0x5E26FA0FE067d28aae8aFf2fB85Ac2E693BD9EfA);
        config[StakeContract] = uint(0xa77A9FcbA2Ae5599e0054369d1655D186020ECE1);
    }

    function create(CreateReq memory poolReq, address[] memory whitelist_) external nonReentrant {
        require(!address(msg.sender).isContract(), "disallow contract caller");
        require(poolReq.amountTotal0 != 0, "the value of amountTotal0 is zero");
        require(poolReq.amountMin1 != 0, "the value of amountMin1 is zero");
        require(poolReq.openAt <= poolReq.closeAt && poolReq.closeAt.sub(poolReq.openAt) < 7 days, "invalid closed");
        require(bytes(poolReq.name).length <= 15, "length of name is too long");

        uint index = pools.length;

        // transfer amount of token0 to this contract
        IERC20  _token0 = IERC20(poolReq.token0);
        uint token0BalanceBefore = _token0.balanceOf(address(this));
        _token0.safeTransferFrom(poolReq.creator, address(this), poolReq.amountTotal0);
        require(
            _token0.balanceOf(address(this)).sub(token0BalanceBefore) == poolReq.amountTotal0,
            "not support deflationary token"
        );

        if (poolReq.enableWhiteList) {
            require(whitelist_.length > 0, "no whitelist imported");
            _addWhitelist(index, whitelist_);
        }

        // creator pool
        Pool memory pool;
        pool.name = poolReq.name;
        pool.creator = poolReq.creator;
        pool.token0 = poolReq.token0;
        pool.token1 = poolReq.token1;
        pool.amountTotal0 = poolReq.amountTotal0;
        pool.amountMin1 = poolReq.amountMin1;
        pool.openAt = poolReq.openAt;
        pool.closeAt = poolReq.closeAt;
        pool.enableWhiteList = poolReq.enableWhiteList;
        pools.push(pool);

        if (poolReq.maxAmount1PerWallet != 0) {
            maxAmount1PerWallet[index] = poolReq.maxAmount1PerWallet;
        }
        if (poolReq.onlyBot) {
            onlyBotHolderP[index] = poolReq.onlyBot;
        }

        myCreatedP[poolReq.creator] = pools.length;
//        bidderListHeaderP[index] = type(uint).max;

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
        address sender = msg.sender;
        require(!address(msg.sender).isContract(), "disallow contract caller");
        Pool memory pool = pools[index];
        if (pool.enableWhiteList) {
            require(whitelistP[index][sender], "sender not in whitelist");
        }
        require(pool.openAt <= now, "pool not open");
        require(amount0 != 0, "the value of amount0 is zero");
        require(amount1 != 0, "the value of amount1 is zero");
        require(myAmountBid1P[sender][index] == 0, "this pool has been bid by this sender");
        require(amount0.mul(getMaxBidCount()) >= pool.amountTotal0, "the bid amount is too low");
        require(amount1 >= maxAmount1PerWallet[index], "the bid amount is lower than minimum ETH");

        // calculate price
        uint minPrice = pool.amountMin1.mul(1 ether).div(pool.amountTotal0);
        uint price = amount1.mul(1 ether).div(amount0);
        require(price >= minPrice, "your bid price is lower than the minimum price");

        address token1 = pool.token1;
        if (token1 == address(0)) {
            require(amount1 == msg.value, "invalid ETH amount");
        } else {
            IERC20(token1).safeTransferFrom(sender, address(this), amount1);
        }

        // record pool index
        myBidP[sender].push(index);
        myPrice[sender][index] = price;
        myAmountBid0P[sender][index] = amount0;
        myAmountBid1P[sender][index] = amount1;
        bidCountP[index]++;

        // check if the sorted bidder list can fill the pool
        adjustBidderList(sender, index, price);

        emit Bid(index, sender, amount0, amount1);
    }

    function creatorClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        address payable creator = msg.sender;
        Pool memory pool = pools[index];
        require(pool.creator == creator, "sender is not pool creator");
        require(!creatorClaimedP[index], "creator has claimed this pool");
        creatorClaimedP[index] = true;

        // remove ownership of this pool from creator
        delete myCreatedP[creator];

        (uint filledAmount0, uint filledAmount1) = creatorFilledAmount(index);
        // calculate un-filled amount0
        uint unFilledAmount0 = pool.amountTotal0.sub(filledAmount0);
        if (unFilledAmount0 > 0) {
            // transfer un-filled amount of token0 back to creator
            IERC20(pool.token0).safeTransfer(creator, unFilledAmount0);
        }

        uint actualAmount1 = filledAmount1;
        if (pool.token1 == address(0)) {
            // calculate transaction fee;
            uint txFee = filledAmount1.mul(getTxFeeRatio()).div(1 ether);
            // calculate actual amount1;
            actualAmount1 = filledAmount1.sub(txFee);
            if (actualAmount1 > 0) {
                // transfer actual amount of token1 to creator
                creator.transfer(actualAmount1);
            }
            if (txFee > 0) {
                // deposit transaction fee to staking contract
                IBounceStake(getStakeContract()).depositReward{value: txFee}();
            }
        } else {
            IERC20(pool.token1).safeTransfer(creator, actualAmount1);
        }

        emit CreatorClaimed(index, creator, unFilledAmount0, actualAmount1);
    }

    function bidderClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        Pool memory pool = pools[index];
        address payable sender = msg.sender;
        require(!myClaimedP[sender][index], "sender has claimed this pool");
        require(
            myAmountBid1P[sender][index] > 0 && bidderListHeaderP[index] != type(uint).max,
            "sender didn't bid this pool"
        );
        myClaimedP[sender][index] = true;

        (uint filledAmount0, uint filledAmount1) = bidderFilledAmount(sender, index);
        uint unFilledAmount1 = myAmountBid1P[sender][index].sub(filledAmount1);

        if (filledAmount0 > 0) {
            // transfer filled amount of token0 to bidder
            IERC20(pool.token0).safeTransfer(sender, filledAmount0);
        }
        if (unFilledAmount1 > 0) {
            // transfer un-filled amount of token1 back to bidder
            if (pool.token1 == address(0)) {
                sender.transfer(unFilledAmount1);
            } else {
                IERC20(pool.token1).safeTransfer(sender, unFilledAmount1);
            }
        }

        emit BidClaimed(index, sender, filledAmount0, unFilledAmount1);
    }

    function adjustBidderList(address sender, uint index, uint newPrice) private {
        address[] storage bidders = bidderListP[index];
        uint[] storage bidderPositions = bidderPositionListP[index];

        if (bidders.length == 0) {
            // bidderListHeaderP[index] = 0; // save gas
            bidderPositions.push(type(uint).max);
        } else {
            uint prevPosition = bidderListHeaderP[index];
            uint curPosition;
            address target = bidders[prevPosition];
            if (newPrice > myPrice[target][index]) {
                bidderListHeaderP[index] = bidders.length;
                bidderPositions.push(prevPosition);
            } else {
                while (true) {
                    curPosition = bidderPositions[prevPosition];
                    if (curPosition == type(uint).max) {
                        break;
                    }
                    target = bidders[curPosition];
                    if (newPrice > myPrice[target][index]) {
                        break;
                    }
                    prevPosition = curPosition;
                }

                bidderPositions[prevPosition] = bidders.length;
                bidderPositions.push(curPosition);
            }
        }
        bidders.push(sender);
    }

    function creatorFilledAmount(uint index) public view returns (uint, uint) {
        Pool memory pool = pools[index];
        uint amountTotal0 = 0;
        uint amountTotal1 = 0;
        address[] storage bidders = bidderListP[index];
        uint[] storage bidderPositions = bidderPositionListP[index];

        if (bidders.length > 0) {
            uint i = bidderListHeaderP[index];
            while(amountTotal0 < pool.amountTotal0) {
                address target = bidders[i];
                if (pool.amountTotal0.sub(amountTotal0) > myAmountBid0P[target][index]) {
                    amountTotal0 = amountTotal0.add(myAmountBid0P[target][index]);
                    amountTotal1 = amountTotal1.add(myAmountBid1P[target][index]);
                } else {
//                    uint _amount0 = pool.amountTotal0.sub(amountTotal0);
                    uint _amount1 = pool.amountTotal0.sub(amountTotal0)
                        .mul(myAmountBid1P[target][index]).div(myAmountBid0P[target][index]);
                    amountTotal0 = pool.amountTotal0;
                    amountTotal1 = amountTotal1.add(_amount1);
                    break;
                }
                i = bidderPositions[i];
                if (i == type(uint).max) {
                    break;
                }
            }
        }

        return (amountTotal0, amountTotal1);
    }

    function bidderFilledAmount(address sender, uint index) public view returns (uint, uint) {
        uint amountTotal0 = 0;
        uint amountTotal1 = 0;
        address[] storage bidders = bidderListP[index];
        uint[] storage bidderPositions = bidderPositionListP[index];

        if (bidders.length == 0) {
            return (0, 0);
        }
        uint i = bidderListHeaderP[index];
        while(amountTotal0 < pools[index].amountTotal0) {
            address target = bidders[i];
            if (pools[index].amountTotal0.sub(amountTotal0) > myAmountBid0P[target][index]) {
                if (sender == target) {
                    return (myAmountBid0P[target][index], myAmountBid1P[target][index]);
                }
                amountTotal0 = amountTotal0.add(myAmountBid0P[target][index]);
                amountTotal1 = amountTotal1.add(myAmountBid1P[target][index]);
            } else {
                uint _amount0 = pools[index].amountTotal0.sub(amountTotal0);
                uint _amount1 = _amount0.mul(myAmountBid1P[target][index]).div(myAmountBid0P[target][index]);
                if (sender == target) {
                    return (_amount0, _amount1);
                }
                return (0, 0);
            }
            i = bidderPositions[i];
            if (i == type(uint).max) {
                return (0, 0);
            }
        }

        return (0, 0);
    }


    function getMyBidPools(address bidder, uint i, uint n) public view returns (uint[] memory r) {
        if(i >= myBidP[bidder].length)
            return r;
        if(n == 0 || i.add(n) > myBidP[bidder].length)
            n = myBidP[bidder].length.sub(i);
        r = new uint[](n);
        for(uint j=0; j<n; j++){
            r[j] = myBidP[bidder][i+j];
        }
    }

    function getBidderListCount(uint index) public view returns (uint) {
        return bidderListP[index].length;
    }

    function getMyBidCount(address bidder) public view returns (uint) {
        return myBidP[bidder].length;
    }

    function getTxFeeRatio() public view returns (uint) {
        return config[TxFeeRatio];
    }

    function getMaxBidCount() public view returns (uint) {
        return config[MaxBidCount];
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

    function _addWhitelist(uint index, address[] memory whitelist_) private {
        for (uint i = 0; i < whitelist_.length; i++) {
            whitelistP[index][whitelist_[i]] = true;
        }
    }

    function addWhitelist(uint index, address[] memory whitelist_) external onlyOwner {
        require(owner() == msg.sender || pools[index].creator == msg.sender, "no permission");
        _addWhitelist(index, whitelist_);
    }

    function removeWhitelist(uint index, address[] memory whitelist_) external onlyOwner {
        require(owner() == msg.sender || pools[index].creator == msg.sender, "no permission");
        for (uint i = 0; i < whitelist_.length; i++) {
            delete whitelistP[index][whitelist_[i]];
        }
    }

    function getPoolCount() external view returns (uint) {
        return pools.length;
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

    modifier isPoolExist(uint index) {
        require(index < pools.length, "this pool does not exist");
        _;
    }
}
