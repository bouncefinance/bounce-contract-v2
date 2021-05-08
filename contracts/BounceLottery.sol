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

    struct Pool {
        uint poolId;
        // address of pool creator
        address payable creator;
        // pool name
        string name;

        address token0;
        //uint  tokenId0;
        uint amount0;

        // per share
        address token1;
        uint amount1;
        uint maxPlayer;
        uint curPlayer;
        //uint nShare;
        //uint blockHeight;

        bool claim;

        uint duration;
        // the timestamp in seconds the pool will open
        uint openAt;
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

    event Created(Pool pool);
    event Bet(address sender, uint poolId);
    event Claimed(address sender, uint poolId);

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

    function create(
        string memory name,
        address token0,
        uint amount0,
        address token1,
        uint amount1,
        uint maxPlayer,
        uint nShare,
    //uint256 curPlayer;
    //bool claim;
    //uint startTime;
        uint duration,
        uint openAt
    ) public payable
    nonReentrant
    nameNotBeenToken(name)
    {
        address payable creator = msg.sender;
        require(amount0 >= nShare, "amount0 less than nShare");
        require(amount1 != 0, "the value of amount1 is zero");
        require(nShare != 0, "the value of nShare is zero");
        require(nShare <= maxPlayer, "max player less than nShare");
        require(maxPlayer < 65536, "max player must less 65536");
        require(maxPlayer > 0, "the value of amount1 is zero");
        require(duration != 0, "the value of duration is zero");
        require(duration <= 30 days, "the value of duration is exceeded 30 days");
        require(bytes(name).length <= 15, "the length of name is too long");

        // transfer token0 to this contract
        IERC20(token0).safeTransferFrom(creator, address(this), amount0);
        // creator pool
        Pool memory pool;
        pool.creator = creator;
        pool.name = name;
        pool.token0 = token0;
        pool.amount0 = amount0;
        pool.token1 = token1;
        pool.amount1 = amount1;
        pool.maxPlayer = maxPlayer;
        pool.duration = duration;
        pool.openAt = openAt;
        //pool.nShare = nShare;

        uint poolId = pools.length + 1;
        pool.poolId = poolId;
        pool.curPlayer = 0;
        pool.claim = false;
        pools.push(pool);
        myCreate[creator].push(poolId);
        name2Id[name] = poolId;
        poolsExt[poolId].nShare = nShare;

        emit Created(pool);
    }

    function getLotteryPoolInfo(uint poolId) public view returns (string memory name, address token0, uint amount0, address token1, uint amount1, uint maxPlayer, uint nShare, uint duration, uint closeTime){
        require((poolId > 0) && (poolId <= pools.length), "No pool ID");
        Pool memory pool = pools[poolId - 1];
        name = pool.name;
        token0 = pool.token0;
        amount0 = pool.amount0;
        token1 = pool.token1;
        amount1 = pool.amount1;
        maxPlayer = pool.maxPlayer;
        nShare = poolsExt[poolId].nShare;
        duration = pool.duration;
        closeTime = pool.openAt.add(pool.duration);
    }

    function getPlayerStatus(uint poolId) public view returns (uint){
        require((poolId > 0) && (poolId <= pools.length), "No pool ID");
        Pool memory pool = pools[poolId - 1];
        if (pool.creator == msg.sender) {
            if (pool.claim) {
                return uint(5);
            }
            return uint(1);
        }
        if (allPlayer[poolId][msg.sender] != 0) {
            if (allPlayerClaim[poolId][msg.sender]) {
                return uint(6);
            }
            return uint(2);
        }
        return uint(0);
    }

    function bet(
        uint poolId
    ) external payable
    nonReentrant
    isPoolExist(poolId)
    isPoolNotClosed(poolId)
    {
        address payable sender = msg.sender;
        uint ethAmount1 = msg.value;
        uint index = poolId - 1;
        Pool memory pool = pools[index];
        require(allPlayer[poolId][sender] == 0, "You have already bet");

        //require(pool.creator != sender, "creator can't bid the pool created by self");

        require(pool.curPlayer < pool.maxPlayer, "Player has reached the upper limit");
        if (pool.token1 == address(0)) {
            require(ethAmount1 >= pool.amount1, "The bet amount is too low");
        } else {
            IERC20(pool.token1).safeTransferFrom(sender, address(this), pool.amount1);
        }
        allPlayer[poolId][sender] = pools[index].curPlayer + 1;
        pools[index].curPlayer += 1;

        myPlay[sender].push(poolId);

        poolsExt[poolId].lastHash = uint(keccak256(abi.encodePacked(block.timestamp, block.difficulty, blockhash(block.number - 1))));

        emit Bet(sender, poolId);
    }

    function creatorClaim(uint poolId) external
    nonReentrant
    isPoolExist(poolId)
    isPoolClosed(poolId)
    {
        address payable sender = msg.sender;
        uint index = poolId - 1;
        require(isCreator(sender, poolId), "sender is not pool creator");

        Pool memory pool = pools[index];
        require(!pool.claim, "creator has claimed this pool");

        pools[index].claim = true;
        if (pool.curPlayer == 0) {
            IERC20(pool.token0).safeTransfer(sender, pool.amount0);
            emit Claimed(sender, poolId);
            return;
        }
        uint nShare = poolsExt[poolId].nShare;
        uint hitShare = (pool.curPlayer > nShare ? nShare : pool.curPlayer);
        if (pool.token1 == address(0)) {
            sender.transfer(pool.amount1.mul(hitShare));
        } else {
            IERC20(pool.token1).safeTransfer(sender, pool.amount1.mul(hitShare));
        }
        if (nShare > pool.curPlayer) {
            IERC20(pool.token0).safeTransfer(sender, pool.amount0.div(nShare).mul(nShare.sub(pool.curPlayer)));
        }

        emit Claimed(sender, poolId);
    }

    function playerClaim(uint poolId) external
    nonReentrant
    isPoolExist(poolId)
    isPoolClosed(poolId)
    {
        address payable sender = msg.sender;
        uint index = poolId - 1;
        require(allPlayer[poolId][sender] > 0, "You haven't bet yet");
        require(!isCreator(sender, poolId), "sender is pool creator");

        Pool memory pool = pools[index];

        require(!allPlayerClaim[poolId][sender], "You have claimed this pool");
        require(pool.openAt.add(pool.duration) < now, "It's not time to start the prize");
        allPlayerClaim[poolId][sender] = true;

        if (isWinner(poolId, address(sender))) {
            IERC20(pool.token0).safeTransfer(sender, pool.amount0.div(poolsExt[poolId].nShare));
        } else {
            if (pool.token1 == address(0)) {
                sender.transfer(pool.amount1);
            } else {
                IERC20(pool.token1).safeTransfer(sender, pool.amount1);
            }
        }
        emit Claimed(sender, poolId);
    }

    function getPoolCount() external view returns (uint) {
        return pools.length;
    }

    function isCreator(address target, uint poolId) private view returns (bool) {
        if (pools[poolId - 1].creator == target) {
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

    function isWinner(uint poolId, address sender) public view returns (bool) {
        require(pools[poolId - 1].openAt.add(pools[poolId - 1].duration) < now, "It's not time to start the prize");
        if (allPlayer[poolId][sender] == 0) {
            return false;
        }
        uint nShare = poolsExt[poolId].nShare;
        uint curPlayer = pools[poolId - 1].curPlayer;

        if (curPlayer <= nShare) {
            return true;
        }

        uint index = poolsExt[poolId].lastHash % curPlayer;

        uint pos = calcRet(allPlayer[poolId][sender] - 1, curPlayer);

        if ((index.add(nShare)) % curPlayer > index) {
            if ((pos >= index) && (pos < (index + nShare))) {
                return true;
            }
        } else {
            if ((pos >= index) && (pos < curPlayer)) {
                return true;
            }
            if (pos < (index.add(nShare)) % curPlayer) {
                return true;
            }
        }
        return false;
    }

    modifier isPoolClosed(uint id) {
        if (pools[id - 1].openAt.add(pools[id - 1].duration) <= now) {
            _;
        } else {
            revert("this pool is not closed");
        }
    }

    modifier isPoolNotClosed(uint id) {
        require(pools[id - 1].openAt.add(pools[id - 1].duration) > now, "this pool is closed");
        _;
    }

    modifier isPoolExist(uint id) {
        require(id <= pools.length, "this pool does not exist");
        _;
    }

    modifier nameNotBeenToken(string memory name) {
        if (name2Id[name] > 0) {
            revert("a live pool has been created by this name");
        }
        _;
    }
}
