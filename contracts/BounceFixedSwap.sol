// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "./Governable.sol";

contract BounceFixedSwap is Configurable, ReentrancyGuardUpgradeSafe {
    using SafeMath for uint;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 internal constant TxFeeRatio            = bytes32("BPRO::TxFeeRatio");
    bytes32 internal constant MinValueOfBotHolder   = bytes32("BPRO::MinValueOfBotHolder");
    bytes32 internal constant BotToken              = bytes32("BPRO::BotToken");
    bytes32 internal constant UsdtToken             = bytes32("BPRO::UsdtToken");
    bytes32 internal constant UniswapV2Router02     = bytes32("BPRO::UniswapV2Router02");
    bytes32 internal constant EnableUniSwap         = bytes32("BPRO::EnableUniSwap");

    address internal constant DeadAddress           = 0x000000000000000000000000000000000000dEaD;

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
        uint amountTotal1;
        // the duration in seconds the pool will be closed
        uint duration;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the delay timestamp in seconds when buyers can claim after pool filled
        uint claimDelaySec;
        bool onlyBot;
        uint maxEthPerWallet;
        bool enableWhiteList;
    }

    struct Pool {
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
        uint amountTotal1;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
        // the delay timestamp in seconds when buyers can claim after pool filled
        uint claimDelaySec;
        // whether or not whitelist is enable
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
    // pool index => maximum swap amount of ETH per wallet, if the value is not set, the default value is zero
    mapping(uint => uint) public maxEthPerWalletP;
    // team address => pool index => whether or not the pool is belong to the address
    mapping(address => mapping(uint => bool)) public teamPool;
    // team address => pool index => whether or not team's pool has been claimed
    mapping(address => mapping(uint => bool)) public teamClaimed;
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

    function initialize() public initializer {
        super.__Ownable_init();
        super.__ReentrancyGuard_init();

        config[TxFeeRatio] = 0.015 ether;
        config[MinValueOfBotHolder] = 60 ether;
        config[EnableUniSwap] = 1;

        // mainnet
        config[UniswapV2Router02] = uint(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        config[BotToken] = uint(0xA9B1Eb5908CfC3cdf91F9B8B3a74108598009096);
        config[UsdtToken] = uint(0xdAC17F958D2ee523a2206206994597C13D831ec7);
    }

    function initialize_rinkeby() public {
        initialize();

        // rinkeby
        config[BotToken] = uint(0x5E26FA0FE067d28aae8aFf2fB85Ac2E693BD9EfA);
        config[UsdtToken] = uint(0x101194a3FF67f83A05B3E15AfA52D45D588614ca);
    }

    function initialize_bsc() public {
        initialize();

        config[EnableUniSwap] = 0;
        config[BotToken] = uint(0x1188d953aFC697C031851169EEf640F23ac8529C);
        config[UsdtToken] = uint(0x55d398326f99059fF775485246999027B3197955); // BUSD-T
    }

    function initialize_okex() public {
        initialize();

        config[EnableUniSwap] = 0;
        config[MinValueOfBotHolder] = 0 ether;
    }

    function create(CreateReq memory poolReq, address[] memory whitelist_) public payable nonReentrant {
        uint index = pools.length;
        require(poolReq.token0 != poolReq.token1, "token0 and token1 is same");
        require(poolReq.amountTotal0 != 0, "invalid amountTotal0");
        require(poolReq.amountTotal1 != 0, "invalid amountTotal1");
        require(poolReq.openAt >= now, "invalid openAt");
        require(poolReq.duration != 0, "invalid duration");
        require(bytes(poolReq.name).length <= 15, "length of name is too long");

        if (poolReq.maxEthPerWallet != 0) {
            maxEthPerWalletP[index] = poolReq.maxEthPerWallet;
        }
        if (poolReq.onlyBot) {
            onlyBotHolderP[index] = poolReq.onlyBot;
        }

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

        _addWhitelist(index, whitelist_);

        Pool memory pool;
        pool.name = poolReq.name;
        pool.creator = poolReq.creator;
        pool.token0 = poolReq.token0;
        pool.token1 = poolReq.token1;
        pool.amountTotal0 = poolReq.amountTotal0;
        pool.amountTotal1 = poolReq.amountTotal1;
        pool.openAt = poolReq.openAt;
        pool.closeAt = poolReq.openAt.add(poolReq.duration);
        pool.claimDelaySec = poolReq.claimDelaySec;
        pool.enableWhiteList = poolReq.enableWhiteList;
        pools.push(pool);

        teamPool[poolReq.creator][index] = true;

        emit Created(index, msg.sender, pool);
    }

    function swap(uint index, uint amount1) external payable
        nonReentrant
        isPoolExist(index)
        isPoolNotClosed(index)
        checkBotHolder(index)
    {
        address payable sender = msg.sender;
        Pool memory pool = pools[index];
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
        if (_amount0 < amount0) {
            require(amount0 - _amount0 > 100, "amount0 is too big");
        } else {
            _amount0 = amount0;
        }

        amountSwap0P[index] = amountSwap0P[index].add(_amount0);
        amountSwap1P[index] = amountSwap1P[index].add(_amount1);
        myAmountSwapped0[sender][index] = myAmountSwapped0[sender][index].add(_amount0);
        // check if swapped amount of token1 is exceeded maximum allowance
        if (maxEthPerWalletP[index] != 0) {
            require(
                myAmountSwapped1[sender][index].add(_amount1) <= maxEthPerWalletP[index],
                "swapped amount of token1 is exceeded maximum allowance"
            );
            myAmountSwapped1[sender][index] = myAmountSwapped1[sender][index].add(_amount1);
        }

        if (pool.amountTotal1 == amountSwap1P[index]) {
            filledAtP[index] = now;
        }

        // transfer amount of token1 to this contract
        if (pool.token1 == address(0)) {
            require(msg.value == amount1, "invalid amount of ETH");
        } else {
            IERC20(pool.token1).safeTransferFrom(sender, address(this), amount1);
        }

        if (pool.claimDelaySec == 0) {
            if (_amount0 > 0) {
                // send token0 to sender
                if (pool.token0 == address(0)) {
                    sender.transfer(_amount0);
                } else {
                    IERC20(pool.token0).safeTransfer(sender, _amount0);
                }
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

    function creatorClaim(uint index) external
        nonReentrant
        isPoolExist(index)
    {
        Pool memory pool = pools[index];
        require(!teamClaimed[pool.creator][index], "claimed");
        teamClaimed[pool.creator][index] = true;

        if (pool.amountTotal1 != amountSwap1P[index]) {
            require(pool.closeAt <= now, "this pool is not closed");
        }

        if (txFeeP[index] > 0) {
            if (pool.token1 == address(0)) {
                swapETH2BotAndBurn(txFeeP[index]);
            } else if (pool.token1 == getUsdtToken()) {
                swapToken2BotAndBurn(getUsdtToken(), txFeeP[index]);
            }
        }

        uint unSwapAmount0 = pool.amountTotal0 - amountSwap0P[index];
        if (unSwapAmount0 > 0) {
            IERC20(pool.token0).safeTransfer(pool.creator, unSwapAmount0);
        }

        emit Claimed(index, msg.sender, unSwapAmount0, txFeeP[index]);
    }

    function userClaim(uint index) external
        nonReentrant
        isPoolExist(index)
    {
        Pool memory pool = pools[index];
        address sender = msg.sender;
        require(pools[index].claimDelaySec > 0, "invalid claim");
        require(!myClaimed[sender][index], "claimed");
        require(pool.closeAt.add(pool.claimDelaySec) <= now, "claim not ready");
        myClaimed[sender][index] = true;
        if (myAmountSwapped0[sender][index] > 0) {
            // send token0 to sender
            if (pool.token0 == address(0)) {
                msg.sender.transfer(myAmountSwapped0[sender][index]);
            } else {
                IERC20(pool.token0).safeTransfer(msg.sender, myAmountSwapped0[sender][index]);
            }
        }
        emit UserClaimed(index, sender, myAmountSwapped0[sender][index]);
    }

    function _addWhitelist(uint index, address[] memory whitelist_) private {
        for (uint i = 0; i < whitelist_.length; i++) {
            whitelistP[index][whitelist_[i]] = true;
        }
    }

    function addWhitelist(uint index, address[] memory whitelist_) public onlyOwner {
        _addWhitelist(index, whitelist_);
    }

    function removeWhitelist(uint index, address[] memory whitelist_) external onlyOwner {
        for (uint i = 0; i < whitelist_.length; i++) {
            delete whitelistP[index][whitelist_[i]];
        }
    }

    function setUniswapV2Router(address router_) external onlyOwner {
        config[UniswapV2Router02] = uint(router_);
    }

    function swapETH2BotAndBurn(uint txFee) private {
        if (getEnableUniSwap()) {
            uint amountOutMin = 0;
            address[] memory path = getPath();
            address to = DeadAddress;
            uint deadline = now.add(20 minutes);
            IUniswapV2Router02(getUniswapV2Router()).swapExactETHForTokens{value: txFee}(amountOutMin, path, to, deadline);
        }
    }

    function swapToken2BotAndBurn(address token, uint txFee) private {
        if (getEnableUniSwap()) {
            address router = getUniswapV2Router();
            IERC20(token).safeApprove(router, txFee);
            uint amountOutMin = 0;
            address[] memory path = getPath2(token);
            address to = DeadAddress;
            uint deadline = now.add(20 minutes);
            IUniswapV2Router02(router).swapExactTokensForTokens(txFee, amountOutMin, path, to, deadline);
        }
    }

    function getPath() internal view returns (address[] memory) {
        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(getUniswapV2Router()).WETH();
        path[1] = getBotToken();

        return path;
    }

    function getPath2(address token) internal view returns (address[] memory) {
        address[] memory path = new address[](3);
        path[0] = token;
        path[1] = IUniswapV2Router02(getUniswapV2Router()).WETH();
        path[2] = getBotToken();

        return path;
    }

    function getEnableUniSwap() public view returns (bool) {
        return config[EnableUniSwap] != 0;
    }

    function getUniswapV2Router() public view returns (address) {
        return address(config[UniswapV2Router02]);
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

    function getUsdtToken() public view returns (address) {
        return address(config[UsdtToken]);
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
