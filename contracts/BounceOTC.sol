// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/Address.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";

contract BounceOTC is Configurable, ReentrancyGuardUpgradeSafe {
    using SafeMath for uint;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using Address for address;

    uint    internal constant PoolTypeSell          = 0;
    uint    internal constant PoolTypeBuy           = 1;
    bytes32 internal constant TxFeeRatio            = bytes32("TxFeeRatio");
    bytes32 internal constant MinValueOfBotHolder   = bytes32("MinValueOfBotHolder");
    bytes32 internal constant BotToken              = bytes32("BotToken");
    bytes32 internal constant StakeContract         = bytes32("StakeContract");

    struct CreateReq {
        // pool name
        string name;
        // address of token0
        address token0;
        // address of token1
        address token1;
        // total amount of token0
        uint amountTotal0;
        // total amount of token1
        uint amountTotal1;
        // the timestamp in seconds the pool will open
        uint openAt;
        uint poolType;
        bool onlyBot;
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
        // total amount of token1
        uint amountTotal1;
        // the timestamp in seconds the pool will open
        uint openAt;
        uint poolType;
        bool enableWhiteList;
    }

    Pool[] public pools;

    // pool index => the timestamp which the pool filled at
    mapping(uint => uint) public filledAtP;
    // pool index => swap amount of token0
    mapping(uint => uint) public amountSwap0P;
    // pool index => swap amount of token1
    mapping(uint => uint) public amountSwap1P;
    // pool index => the swap pool only allow BOT holder to take part in
    mapping(uint => bool) public onlyBotHolderP;
    // team address => pool index => whether or not creator's pool has been claimed
    mapping(address => mapping(uint => bool)) public creatorClaimed;
    // user address => pool index => swapped amount of token0
    mapping(address => mapping(uint => uint)) public myAmountSwapped0;
    // user address => pool index => swapped amount of token1
    mapping(address => mapping(uint => uint)) public myAmountSwapped1;
    // user address => pool index => whether or not my pool has been claimed
    mapping(address => mapping(uint => bool)) public myClaimed;

    // pool index => account => whether or not in white list
    mapping(uint => mapping(address => bool)) public whitelistP;
    // pool index => transaction fee
    mapping(uint => uint) public txFeeP;

    event Created(uint indexed index, address indexed sender, Pool pool);
    event Swapped(uint indexed index, address indexed sender, uint amount0, uint amount1, uint txFee);
    event Claimed(uint indexed index, address indexed sender, uint amount0, uint txFee);
    event UserClaimed(uint indexed index, address indexed sender, uint amount0);

    function initialize(
        uint txFeeRatio,
        uint minBotHolder,
        address botToken,
        address stakeContract
    ) public initializer {
        super.__Ownable_init();
        super.__ReentrancyGuard_init();

        config[TxFeeRatio] = txFeeRatio;
        config[MinValueOfBotHolder] = minBotHolder;

        config[BotToken] = uint(botToken); // AUCTION
        config[StakeContract] = uint(stakeContract);
    }

    function create(CreateReq memory poolReq, address[] memory whitelist_) external payable nonReentrant {
        uint index = pools.length;
        require(tx.origin == msg.sender, "disallow contract caller");
        require(poolReq.amountTotal0 != 0, "invalid amountTotal0");
        require(poolReq.amountTotal1 != 0, "invalid amountTotal1");
        require(poolReq.openAt >= now, "invalid openAt");
        require(poolReq.poolType == PoolTypeSell || poolReq.poolType == PoolTypeBuy, "invalid poolType");
        require(bytes(poolReq.name).length <= 15, "length of name is too long");

        if (poolReq.onlyBot) {
            require(getBotToken() != address(0), "BOT holder not supported");
            onlyBotHolderP[index] = poolReq.onlyBot;
        }

        if (poolReq.token0 == address(0)) {
            require(poolReq.amountTotal0 == msg.value, "invalid amountTotal0");
        } else {
            // transfer amount of token0 to this contract
            IERC20  _token0 = IERC20(poolReq.token0);
            uint token0BalanceBefore = _token0.balanceOf(address(this));
            _token0.safeTransferFrom(msg.sender, address(this), poolReq.amountTotal0);
            require(
                _token0.balanceOf(address(this)).sub(token0BalanceBefore) == poolReq.amountTotal0,
                "not support deflationary token"
            );
        }

        if (poolReq.enableWhiteList) {
            require(whitelist_.length > 0, "no whitelist imported");
            _addWhitelist(index, whitelist_);
        }

        Pool memory pool;
        pool.name = poolReq.name;
        pool.creator = msg.sender;
        pool.token0 = poolReq.token0;
        pool.token1 = poolReq.token1;
        pool.amountTotal0 = poolReq.amountTotal0;
        pool.amountTotal1 = poolReq.amountTotal1;
        pool.openAt = poolReq.openAt;
        pool.poolType = poolReq.poolType;
        pool.enableWhiteList = poolReq.enableWhiteList;
        pools.push(pool);

        emit Created(index, msg.sender, pool);
    }

    function swap(uint index, uint amount1) external payable
        nonReentrant
        isPoolExist(index)
        checkBotHolder(index)
    {
        address payable sender = msg.sender;
        require(tx.origin == msg.sender, "disallow contract caller");
        Pool memory pool = pools[index];
        require(!creatorClaimed[pool.creator][index], "pool de-listed");

        if (pool.enableWhiteList) {
            require(whitelistP[index][sender], "sender not in whitelist");
        }
        require(pool.openAt <= now, "pool not open");
        require(pool.amountTotal1 > amountSwap1P[index], "swap amount is zero");

        // check if amount1 is exceeded
        uint excessAmount1 = 0;
        uint _amount1 = pool.amountTotal1.sub(amountSwap1P[index]);
        if (_amount1 < amount1) {
            excessAmount1 = amount1.sub(_amount1);
        } else {
            _amount1 = amount1;
        }

        // check if amount0 is exceeded
        uint amount0 = _amount1.mul(pool.amountTotal0).div(pool.amountTotal1);
        uint _amount0 = pool.amountTotal0.sub(amountSwap0P[index]);
        if (_amount0 > amount0) {
            _amount0 = amount0;
        }

        amountSwap0P[index] = amountSwap0P[index].add(_amount0);
        amountSwap1P[index] = amountSwap1P[index].add(_amount1);
        myAmountSwapped0[sender][index] = myAmountSwapped0[sender][index].add(_amount0);
        myAmountSwapped1[sender][index] = myAmountSwapped1[sender][index].add(_amount1);

        if (pool.amountTotal1 == amountSwap1P[index]) {
            filledAtP[index] = now;
        }

        // transfer amount of token1 to this contract
        if (pool.token1 == address(0)) {
            require(msg.value == amount1, "invalid amount of ETH");
        } else {
            IERC20(pool.token1).safeTransferFrom(sender, address(this), amount1);
        }

        if (_amount0 > 0) {
            // send token0 to sender
            if (pool.token0 == address(0)) {
                sender.transfer(_amount0);
            } else {
                IERC20(pool.token0).safeTransfer(sender, _amount0);
            }
        }
        if (excessAmount1 > 0) {
            // send excess amount of token1 back to sender
            if (pool.token1 == address(0)) {
                sender.transfer(excessAmount1);
            } else {
                IERC20(pool.token1).safeTransfer(sender, excessAmount1);
            }
        }

        // send token1 to creator
        uint256 txFee = _amount1.mul(getTxFeeRatio()).div(1 ether);
        txFeeP[index] = txFeeP[index].add(txFee);
        uint256 _actualAmount1 = _amount1.sub(txFee);
        if (_actualAmount1 > 0) {
            if (pool.token1 == address(0)) {
                pool.creator.transfer(_actualAmount1);
            } else {
                IERC20(pool.token1).safeTransfer(pool.creator, _actualAmount1);
            }
        }

        emit Swapped(index, sender, _amount0, _actualAmount1, txFee);
    }

    function deList(uint index) external
        nonReentrant
        isPoolExist(index)
    {
        Pool memory pool = pools[index];
        require(pool.creator == msg.sender, "not creator");
        require(!creatorClaimed[pool.creator][index], "claimed");
        creatorClaimed[pool.creator][index] = true;

        if (txFeeP[index] > 0) {
            if (pool.token1 == address(0)) {
                // deposit transaction fee to staking contract
                payable(getStakeContract()).transfer(txFeeP[index]);
            } else {
                IERC20(pool.token1).safeTransfer(getStakeContract(), txFeeP[index]);
            }
        }

        uint unSwapAmount0 = pool.amountTotal0.sub(amountSwap0P[index]);
        if (unSwapAmount0 > 0) {
            if (pool.token0 == address(0)) {
                pool.creator.transfer(unSwapAmount0);
            } else {
                IERC20(pool.token0).safeTransfer(pool.creator, unSwapAmount0);
            }
        }

        emit Claimed(index, msg.sender, unSwapAmount0, txFeeP[index]);
    }

    function _addWhitelist(uint index, address[] memory whitelist_) private {
        for (uint i = 0; i < whitelist_.length; i++) {
            whitelistP[index][whitelist_[i]] = true;
        }
    }

    function addWhitelist(uint index, address[] memory whitelist_) external {
        require(owner() == msg.sender || pools[index].creator == msg.sender, "no permission");
        _addWhitelist(index, whitelist_);
    }

    function removeWhitelist(uint index, address[] memory whitelist_) external {
        require(owner() == msg.sender || pools[index].creator == msg.sender, "no permission");
        for (uint i = 0; i < whitelist_.length; i++) {
            delete whitelistP[index][whitelist_[i]];
        }
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

    modifier isPoolExist(uint index) {
        require(index < pools.length, "this pool does not exist");
        _;
    }

    modifier checkBotHolder(uint index) {
        if (onlyBotHolderP[index]) {
            require(
                IERC20(getBotToken()).balanceOf(msg.sender) >= getMinValueOfBotHolder(),
                "Auction is not enough"
            );
        }
        _;
    }
}
