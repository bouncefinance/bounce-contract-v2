// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";

contract BounceLottery is Configurable, ReentrancyGuardUpgradeSafe {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct CreateReq {
        // pool name
        string name;
        // address of pool creator
        address payable creator;
        address token0;
        uint amountTotal0;
        // per share
        address token1;
        uint amountTotal1;
        uint maxPlayer;
        uint curPlayer;
        //uint nShare;
        //uint blockHeight;
        bool claim;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
        bool enableWhiteList;
        uint nShare;
    }

    struct Pool {
        uint poolId;
        // pool name
        string name;
        // address of pool creator
        address payable creator;
        address token0;
        uint amountTotal0;
        // per share
        address token1;
        uint amountTotal1;
        uint maxPlayer;
        uint curPlayer;
        //uint nShare;
        //uint blockHeight;
        bool claim;
        // the timestamp in seconds the pool will open
        uint openAt;
        // the timestamp in seconds the pool will be closed
        uint closeAt;
        bool enableWhiteList;
    }

    struct PoolExt {
        uint lastHash;
        bytes32 hash;
        uint nShare;
    }

    Pool[] public pools;

    // pool ID =>  all player =>Serial number-start from 1
    mapping(uint => mapping(address => uint)) public allPlayer;
    // pool ID =>  all player =>if claim
    mapping(uint => mapping(address => bool)) public allPlayerClaim;
    //pool ID =>PoolExt
    mapping(uint => PoolExt) public poolsExt;

    //address create poolsID
    mapping(address => uint[]) public myCreate;
    //address bet poolsID
    mapping(address => uint[]) public myPlay;

    // name => pool index
    mapping(string => uint) public name2Id;

    // pool index => account => whether or not in white list
    mapping(uint => mapping(address => bool)) public whitelistP;

    event Created(Pool pool);
    event Bet(address sender, uint index);
    event Claimed(address sender, uint index);

    function initialize() public initializer {
        super.__Ownable_init();

        /*        config[TxFeeRatio] = 0.01 ether;
                config[MinValueOfBotHolder] = 0.1 ether;
                config[MinValueOfBotCreator] = 0 ether;
                config[MiningDifficulty] = 3 ether;
                config[EnableUniSwap] = 1;
                config[BotToken] = uint(0x5bEaBAEBB3146685Dd74176f68a0721F91297D37);
                config[BounceContract] = uint(0x73282A63F0e3D7e9604575420F777361ecA3C86A);*/
    }

    function create(CreateReq memory poolReq, address[] memory whitelist_) external
        nonReentrant
        nameNotBeenToken(poolReq.name)
    {
        require(poolReq.amountTotal0 >= poolReq.nShare, "amountTotal0 less than nShare");
        require(poolReq.amountTotal1 != 0, "the value of amountTotal1 is zero");
        require(poolReq.nShare != 0, "the value of nShare is zero");
        require(poolReq.nShare <= poolReq.maxPlayer, "max player less than nShare");
        require(poolReq.maxPlayer < 65536, "max player must less 65536");
        require(poolReq.maxPlayer > 0, "the value of maxPlayer is zero");
        require(poolReq.openAt <= poolReq.closeAt && poolReq.closeAt.sub(poolReq.openAt) < 7 days, "invalid closed");
        require(bytes(poolReq.name).length <= 15, "the length of name is too long");

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

        _addWhitelist(index, whitelist_);

        // creator pool
        Pool memory pool;
        pool.creator = poolReq.creator;
        pool.name = poolReq.name;
        pool.token0 = poolReq.token0;
        pool.amountTotal0 = poolReq.amountTotal0;
        pool.token1 = poolReq.token1;
        pool.amountTotal1 = poolReq.amountTotal1;
        pool.maxPlayer = poolReq.maxPlayer;
        pool.openAt = poolReq.openAt;
        pool.closeAt = poolReq.closeAt;
        pool.enableWhiteList = poolReq.enableWhiteList;
        //pool.nShare = nShare;

        pool.poolId = index;
        pool.curPlayer = 0;
        pool.claim = false;
        pools.push(pool);
        myCreate[poolReq.creator].push(index);
        name2Id[poolReq.name] = index;
        poolsExt[index].nShare = poolReq.nShare;

        emit Created(pool);
    }

    function getLotteryPoolInfo(uint index) public view returns (string memory name, address token0, uint amountTotal0, address token1, uint amountTotal1, uint maxPlayer, uint nShare, uint duration, uint closeTime){
        require(index < pools.length, "No pool ID");
        Pool memory pool = pools[index];
        name = pool.name;
        token0 = pool.token0;
        amountTotal0 = pool.amountTotal0;
        token1 = pool.token1;
        amountTotal1 = pool.amountTotal1;
        maxPlayer = pool.maxPlayer;
        nShare = poolsExt[index].nShare;
        duration = pool.closeAt.sub(pool.openAt);
        closeTime = pool.closeAt;
    }

    function getPlayerStatus(uint index) public view returns (uint) {
        require(index < pools.length, "No pool ID");
        Pool memory pool = pools[index];
        if (pool.creator == msg.sender) {
            if (pool.claim) {
                return uint(5);
            }
            return uint(1);
        }
        if (allPlayer[index][msg.sender] != 0) {
            if (allPlayerClaim[index][msg.sender]) {
                return uint(6);
            }
            return uint(2);
        }
        return uint(0);
    }

    function bet(
        uint index
    ) external payable
        nonReentrant
        isPoolExist(index)
        isPoolNotClosed(index)
    {
        address payable sender = msg.sender;
        uint ethAmount1 = msg.value;
        Pool memory pool = pools[index];
        require(allPlayer[index][sender] == 0, "You have already bet");

        if (pool.enableWhiteList) {
            require(whitelistP[index][sender], "sender not in whitelist");
        }

        //require(pool.creator != sender, "creator can't bid the pool created by self");

        require(pool.curPlayer < pool.maxPlayer, "Player has reached the upper limit");
        if (pool.token1 == address(0)) {
            require(ethAmount1 >= pool.amountTotal1, "The bet amount is too low");
        } else {
            IERC20(pool.token1).safeTransferFrom(sender, address(this), pool.amountTotal1);
        }
        allPlayer[index][sender] = pools[index].curPlayer + 1;
        pools[index].curPlayer += 1;

        myPlay[sender].push(index);

        poolsExt[index].lastHash = uint(keccak256(abi.encodePacked(block.timestamp, block.difficulty, blockhash(block.number - 1))));

        emit Bet(sender, index);
    }

    function creatorClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        address payable sender = msg.sender;
        require(isCreator(sender, index), "sender is not pool creator");

        Pool memory pool = pools[index];
        require(!pool.claim, "creator has claimed this pool");

        pools[index].claim = true;
        if (pool.curPlayer == 0) {
            IERC20(pool.token0).safeTransfer(sender, pool.amountTotal0);
            emit Claimed(sender, index);
            return;
        }
        uint nShare = poolsExt[index].nShare;
        uint hitShare = (pool.curPlayer > nShare ? nShare : pool.curPlayer);
        if (pool.token1 == address(0)) {
            sender.transfer(pool.amountTotal1.mul(hitShare));
        } else {
            IERC20(pool.token1).safeTransfer(sender, pool.amountTotal1.mul(hitShare));
        }
        if (nShare > pool.curPlayer) {
            IERC20(pool.token0).safeTransfer(sender, pool.amountTotal0.div(nShare).mul(nShare.sub(pool.curPlayer)));
        }

        emit Claimed(sender, index);
    }

    function playerClaim(uint index) external
        nonReentrant
        isPoolExist(index)
        isPoolClosed(index)
    {
        address payable sender = msg.sender;
        require(allPlayer[index][sender] > 0, "You haven't bet yet");
        require(!isCreator(sender, index), "sender is pool creator");

        Pool memory pool = pools[index];

        require(!allPlayerClaim[index][sender], "You have claimed this pool");
        require(pool.closeAt < now, "It's not time to start the prize");
        allPlayerClaim[index][sender] = true;

        if (isWinner(index, address(sender))) {
            IERC20(pool.token0).safeTransfer(sender, pool.amountTotal0.div(poolsExt[index].nShare));
        } else {
            if (pool.token1 == address(0)) {
                sender.transfer(pool.amountTotal1);
            } else {
                IERC20(pool.token1).safeTransfer(sender, pool.amountTotal1);
            }
        }
        emit Claimed(sender, index);
    }

    function getPoolCount() external view returns (uint) {
        return pools.length;
    }

    function isCreator(address target, uint index) private view returns (bool) {
        if (pools[index].creator == target) {
            return true;
        }
        return false;
    }

    function lo2(uint value) pure public returns (uint){
        require(value < 65536, "too large");
        if (value <= 2) {
            return uint(0);
        } else if (value == 3) {
            return uint(2);
        }
        uint x = 0;
        uint s = value;
        while (value > 1) {
            value >>= 1;
            x++;
        }
        if (s > ((2 << (x.sub(1))) + (2 << (x.sub(2)))))
            return (x.mul(2).add(1));
        return (x.mul(2));
    }

    function calcRet(uint index, uint m) public pure returns (uint){
        uint[32] memory p = [uint(3), 3, 5, 7, 17, 11, 7, 11, 13, 23, 31, 47, 61, 89, 127, 191, 251, 383, 509, 761, 1021, 1531, 2039, 3067, 4093, 6143, 8191, 12281, 16381, 24571, 32749, 49139];
        uint nSel = lo2(m);
        return (index.mul(p[nSel])) % m;
    }

    function isWinner(uint index, address sender) public view returns (bool) {
        require(pools[index].closeAt < now, "It's not time to start the prize");
        if (allPlayer[index][sender] == 0) {
            return false;
        }
        uint nShare = poolsExt[index].nShare;
        uint curPlayer = pools[index].curPlayer;

        if (curPlayer <= nShare) {
            return true;
        }

        uint n = poolsExt[index].lastHash % curPlayer;

        uint pos = calcRet(allPlayer[index][sender] - 1, curPlayer);

        if ((n.add(nShare)) % curPlayer > n) {
            if ((pos >= n) && (pos < (n + nShare))) {
                return true;
            }
        } else {
            if ((pos >= n) && (pos < curPlayer)) {
                return true;
            }
            if (pos < (n.add(nShare)) % curPlayer) {
                return true;
            }
        }
        return false;
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

    modifier isPoolClosed(uint index) {
        if (pools[index].closeAt <= now) {
            _;
        } else {
            revert("this pool is not closed");
        }
    }

    modifier isPoolNotClosed(uint index) {
        require(pools[index].closeAt > now, "this pool is closed");
        _;
    }

    modifier isPoolExist(uint index) {
        require(index < pools.length, "this pool does not exist");
        _;
    }

    modifier nameNotBeenToken(string memory name) {
        if (name2Id[name] > 0) {
            revert("a live pool has been created by this name");
        }
        _;
    }
}
