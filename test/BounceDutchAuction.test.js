// Load dependencies
const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = constants;

// Load compiled artifacts
const BounceDutchAuction = contract.fromArtifact('BounceDutchAuction');
const ERC20 = contract.fromArtifact('@openzeppelin/contracts/ERC20PresetMinterPauser');
const BounceStake = contract.fromArtifact(require('path').resolve('test/BounceStakeSimple'));
const USDT = contract.fromArtifact(require('path').resolve('test/TetherToken'));

function usd (n) {
    return ether(n).div(new BN('10').pow(new BN('12')));
}

// Start test block
describe('BounceDutchAuction', function () {
    const [ owner, creator, governor, bidder1, bidder2, bidder3 ] = accounts;

    beforeEach(async function () {
        // Deploy BounceDutchAuction contract for each test
        this.da = await BounceDutchAuction.new({ from: owner });
        // Deploy Bounce Stake contract for each test
        this.bounceStake = await BounceStake.new({ from: owner });

        // Deploy a ERC20 contract for each test
        this.erc20Token = await ERC20.new('Bounce Token', 'BOT', { from: owner });
        this.usdToken = await USDT.new(usd('500000'), 'USD Token', 'USDT', 6, { from: owner });

        // initialize Bounce contract
        await this.da.initialize({ from: governor });
        await expectRevert(this.da.initialize({ from: owner }), 'Contract instance has already been initialized.');
        await this.da.setConfig(web3.utils.fromAscii("TxFeeRatio"), ether('0.02'), { from: governor });
        await this.da.setConfig(web3.utils.fromAscii("MinValueOfBotHolder"), ether('0.1'), { from: governor });
        await this.da.setConfig(web3.utils.fromAscii("BotToken"), this.erc20Token.address, { from: governor });
        await this.da.setConfig(web3.utils.fromAscii("StakeContract"), this.bounceStake.address, { from: governor });
        await expectRevert.unspecified(
            this.da.setConfig(web3.utils.fromAscii("TxFeeRatio"), ether('0.02'), { from: owner })
        );
        expect(await this.da.getTxFeeRatio()).to.be.bignumber.equal(ether('0.02'));
        expect(await this.da.getMinValueOfBotHolder()).to.be.bignumber.equal(ether('0.1'));
        expect(await this.da.getBotToken()).to.equal(this.erc20Token.address);
        expect(await this.da.getStakeContract()).to.equal(this.bounceStake.address);

        // mint BOT token
        await this.erc20Token.mint(this.da.address, ether('10000'), { from: owner });
        await this.erc20Token.mint(creator, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder1, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder2, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder3, ether('10000'), { from: owner });

        // mint USD token
        await this.usdToken.transfer(this.da.address, usd('10000'), { from: owner });
        await this.usdToken.transfer(creator, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder1, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder2, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder3, usd('10000'), { from: owner });
    });

    describe('create dutch auction pool ERC20/ETH', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = ZERO_ADDRESS;
            const amountTotal0 = ether('20');
            const amountMax1 = ether('20');
            const amountMin1 = ether('10');
            const times = 4;
            const duration = 50;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const index = 0;
            const createReq = [
                name, creator, token0, token1, amountTotal0, amountMax1, amountMin1, times, duration, openAt, onlyBot,
            ];
            await this.erc20Token.approve(this.da.address, amountTotal0, { from: creator });
            await this.da.create(createReq, [], { from: creator });
            const pool = await this.da.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountMax1).to.be.bignumber.equal(amountMax1);
            expect(pool.amountMin1).to.be.bignumber.equal(amountMin1);
            expect(pool.times).to.be.bignumber.equal(new BN(times));
            expect(pool.duration).to.be.bignumber.equal(new BN(duration));
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.gt(new BN(duration));
            expect(await this.da.onlyBotHolderP(index)).to.equal(true);
            expect(await this.da.myCreatedP(creator)).to.be.bignumber.equal(new BN('1'));
            expect(await this.da.creatorClaimedP(index)).to.equal(false);
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
        });

        it('when bid ERC20/ETH 1', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('1');
            let amount1 = ether('1');
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));

            await this.da.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder1, index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.myAmountSwap1P(bidder1, index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('1'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));

            amount0 = ether('1'); amount1 = ether('0.9');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder1, value: amount1 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(ether('0.9'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('2'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('1.9'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('0.9'));

            amount0 = ether('1'); amount1 = ether('0.8');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('2'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(ether('1.7'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('3'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('2.7'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('0.8'));

            amount0 = ether('1'); amount1 = ether('0.7');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('3'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(ether('2.4'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('4'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('3.4'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('0.7'));

            amount0 = ether('1'); amount1 = ether('0.6');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('4'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(ether('3'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('4'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('0.6'));

            amount0 = ether('1'); amount1 = ether('0.5');
            await time.increase(time.duration.seconds(5));
            await this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('5'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(ether('3.5'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('6'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(ether('4.5'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(ether('0.5'));

            await expectRevert(this.da.creatorClaim(index, { from: creator }), "this pool is not closed");
            await expectRevert(this.da.creatorClaim(100, { from: bidder1 }), "this pool does not exist");
            await expectRevert(this.da.creatorClaim(1, { from: bidder1 }), "this pool does not exist");
            await time.increase(time.duration.seconds(5));
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2, value: amount1 }), "this pool is closed");
            await expectRevert(this.da.creatorClaim(index, { from: bidder1 }), "sender is not pool creator");
            await this.da.creatorClaim(index, { from: creator });
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10006'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            await expectRevert(this.da.creatorClaim(index, { from: creator }), "creator has claimed this pool");

            expect(await this.da.bidderClaimedP(bidder1, index)).to.equal(false);
            await this.da.bidderClaim(index, { from: bidder1 });
            expect(await this.da.bidderClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10001'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            await expectRevert(this.da.bidderClaim(index, { from: bidder1 }), "bidder has claimed this pool");

            expect(await this.da.bidderClaimedP(bidder2, index)).to.equal(false);
            await this.da.bidderClaim(index, { from: bidder2 });
            expect(await this.da.bidderClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10001'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            await expectRevert(this.da.bidderClaim(index, { from: bidder2 }), "bidder has claimed this pool");
        });

        it('when no bid', async function () {
            const index = 0;
            await time.increase(time.duration.days(1));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            this.da.creatorClaim(index, { from: creator });
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('10000'));
        });
    });

    describe('create dutch auction pool ERC20/USDT', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = this.usdToken.address;
            const amountTotal0 = ether('20');
            const amountMax1 = usd('20');
            const amountMin1 = usd('10');
            const times = 4;
            const duration = 50;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const index = 0;
            const createReq = [
                name, creator, token0, token1, amountTotal0, amountMax1, amountMin1, times, duration, openAt, onlyBot,
            ];
            await this.erc20Token.approve(this.da.address, amountTotal0, { from: creator });
            await this.da.create(createReq, [], { from: creator });
            const pool = await this.da.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountMax1).to.be.bignumber.equal(amountMax1);
            expect(pool.amountMin1).to.be.bignumber.equal(amountMin1);
            expect(pool.times).to.be.bignumber.equal(new BN(times));
            expect(pool.duration).to.be.bignumber.equal(new BN(duration));
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.gt(new BN(duration));
            expect(await this.da.onlyBotHolderP(index)).to.equal(true);
            expect(await this.da.myCreatedP(creator)).to.be.bignumber.equal(new BN('1'));
            expect(await this.da.creatorClaimedP(index)).to.equal(false);
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('10000'));
        });

        it('when bid ERC20/USDT 1', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('1');
            let amount1 = usd('1');
            await this.usdToken.approve(this.da.address, amount1, { from: bidder1 });
            await this.da.bid(index, amount0, amount1, { from: bidder1 });
            expect(await this.da.myAmountSwap0P(bidder1, index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.myAmountSwap1P(bidder1, index)).to.be.bignumber.equal(usd('1'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('1'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('1'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10001'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            amount0 = ether('1'); amount1 = usd('0.9');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder1 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.usdToken.approve(this.da.address, amount1, { from: bidder2 });
            await this.da.bid(index, amount0, amount1, { from: bidder2 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('1'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(usd('0.9'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('2'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('1.9'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('0.9'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10001.9'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9999.1'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            amount0 = ether('1'); amount1 = usd('0.8');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.usdToken.approve(this.da.address, amount1, { from: bidder2 });
            await this.da.bid(index, amount0, amount1, { from: bidder2 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('2'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(usd('1.7'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('3'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('2.7'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('0.8'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10002.7'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9998.3'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            amount0 = ether('1'); amount1 = usd('0.7');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.usdToken.approve(this.da.address, amount1, { from: bidder2 });
            await this.da.bid(index, amount0, amount1, { from: bidder2 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('3'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(usd('2.4'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('4'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('3.4'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('0.7'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10003.4'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9997.6'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            amount0 = ether('1'); amount1 = usd('0.6');
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2 }), "the bid price is lower than the current price");
            await time.increase(time.duration.seconds(10));
            await this.usdToken.approve(this.da.address, amount1, { from: bidder2 });
            await this.da.bid(index, amount0, amount1, { from: bidder2 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('4'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(usd('3'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('4'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('0.6'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10004'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9997'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            amount0 = ether('1'); amount1 = usd('0.5');
            await time.increase(time.duration.seconds(5));
            await this.usdToken.approve(this.da.address, amount1, { from: bidder2 });
            await this.da.bid(index, amount0, amount1, { from: bidder2 });
            expect(await this.da.myAmountSwap0P(bidder2, index)).to.be.bignumber.equal(ether('5'));
            expect(await this.da.myAmountSwap1P(bidder2, index)).to.be.bignumber.equal(usd('3.5'));
            expect(await this.da.amountSwap0P(index)).to.be.bignumber.equal(ether('6'));
            expect(await this.da.amountSwap1P(index)).to.be.bignumber.equal(usd('4.5'));
            expect(await this.da.lowestBidPrice(index)).to.be.bignumber.equal(usd('0.5'));
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10020'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10004.5'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9996.5'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));

            await expectRevert(this.da.creatorClaim(index, { from: creator }), "this pool is not closed");
            await expectRevert(this.da.creatorClaim(100, { from: bidder1 }), "this pool does not exist");
            await expectRevert(this.da.creatorClaim(1, { from: bidder1 }), "this pool does not exist");
            await time.increase(time.duration.seconds(5));
            await expectRevert(this.da.bid(index, amount0, amount1, { from: bidder2 }), "this pool is closed");
            await expectRevert(this.da.creatorClaim(index, { from: bidder1 }), "sender is not pool creator");
            await this.da.creatorClaim(index, { from: creator });
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10006'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10001.5')); // 4.5 - 6*0.5
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9996.5'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10003')); // 6*0.5
            await expectRevert(this.da.creatorClaim(index, { from: creator }), "creator has claimed this pool");

            expect(await this.da.bidderClaimedP(bidder1, index)).to.equal(false);
            await this.da.bidderClaim(index, { from: bidder1 });
            expect(await this.da.bidderClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10001'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10001'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999.5'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9996.5'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10003'));
            await expectRevert(this.da.bidderClaim(index, { from: bidder1 }), "bidder has claimed this pool");

            expect(await this.da.bidderClaimedP(bidder2, index)).to.equal(false);
            await this.da.bidderClaim(index, { from: bidder2 });
            expect(await this.da.bidderClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(this.da.address)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10001'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9994'));
            expect(await this.usdToken.balanceOf(this.da.address)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9999.5'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9997.5'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10003'));
            await expectRevert(this.da.bidderClaim(index, { from: bidder2 }), "bidder has claimed this pool");
        });

        it('when no bid', async function () {
            const index = 0;
            await time.increase(time.duration.days(1));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            await this.da.creatorClaim(index, { from: creator });
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('10000'));
        });
    });
});
