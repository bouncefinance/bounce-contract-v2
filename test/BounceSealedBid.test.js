// Load dependencies
const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { MAX_UINT256, ZERO_ADDRESS } = constants;

// Load compiled artifacts
const BounceSealedBid = contract.fromArtifact('BounceSealedBid');
const ERC20 = contract.fromArtifact('@openzeppelin/contracts/ERC20PresetMinterPauser');
const USDT = contract.fromArtifact(require('path').resolve('test/TetherToken'));
// const BounceStake = contract.fromArtifact('BounceStakeSimple');

function usd (n) {
    return ether(n).div(new BN('10').pow(new BN('12')));
}

// Start test block
describe('BounceSealedBid', function () {
    const [ owner, creator, governor, bidder1, bidder2, bidder3 ] = accounts;

    beforeEach(async function () {
        // Deploy Bounce Sealed Bid contract for each test
        this.sb = await BounceSealedBid.new({ from: owner });
        // Deploy Bounce Stake contract for each test
        // this.bounceStake = await BounceStake.new({ from: owner });

        // Deploy a ERC20 contract for each test
        this.erc20Token = await ERC20.new('Bounce Token', 'BOT', { from: owner });
        this.usdToken = await USDT.new(usd('500000'), 'USD Token', 'USDT', 6, { from: owner });

        // initialize Bounce contract
        await this.sb.initialize({ from: governor });
        await expectRevert(this.sb.initialize({ from: owner }), 'Contract instance has already been initialized');
        await this.sb.setConfig(web3.utils.fromAscii("SBP::TxFeeRatio"), ether('0.02'), { from: governor });
        await this.sb.setConfig(web3.utils.fromAscii("SBP::MaxBidCount"), 1000, { from: governor });
        await this.sb.setConfig(web3.utils.fromAscii("SBP::MinValueOfBotHolder"), ether('0.5'), { from: governor });
        await this.sb.setConfig(web3.utils.fromAscii("SBP::BotToken"), this.erc20Token.address, { from: governor });
        // await this.sb.setConfig(web3.utils.fromAscii("SBP::StakeContract"), this.bounceStake.address, { from: governor });
        expect(await this.sb.getTxFeeRatio()).to.be.bignumber.equal(ether('0.02'));
        expect(await this.sb.getMinValueOfBotHolder()).to.be.bignumber.equal(ether('0.5'));
        expect(await this.sb.getMaxBidCount()).to.be.bignumber.equal(new BN('1000'));
        expect(await this.sb.getBotToken()).to.equal(this.erc20Token.address);
        // expect(await this.sb.getStakeContract()).to.equal(this.bounceStake.address);

        // mint BOT token
        await this.erc20Token.mint(this.sb.address, ether('10000'), { from: owner });
        await this.erc20Token.mint(creator, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder1, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder2, ether('10000'), { from: owner });
        await this.erc20Token.mint(bidder3, ether('10000'), { from: owner });

        // mint USD token
        await this.usdToken.transfer(this.sb.address, usd('10000'), { from: owner });
        await this.usdToken.transfer(creator, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder1, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder2, usd('10000'), { from: owner });
        await this.usdToken.transfer(bidder3, usd('10000'), { from: owner });
    });

    describe('create sealed bid pool ERC20/ETH', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = ZERO_ADDRESS;
            const amountTotal0 = ether('20');
            const amountMin1 = ether('10');
            const duration = 86400;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const minEthPerWallet = ether('0.1');
            const index = 0;
            const createReq = [
                name, creator, token0, token1, amountTotal0, amountMin1, duration, openAt, onlyBot, minEthPerWallet
            ];
            await this.erc20Token.approve(this.sb.address, amountTotal0, { from: creator });
            await this.sb.create(createReq, [], { from: creator });
            const pool = await this.sb.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountMin1).to.be.bignumber.equal(amountMin1);
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.gt(new BN(duration));
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
        });

        it('when bid ERC20/ETH 1', async function () {
            const index = 0;
            let amount0 = ether('10');
            let amount1 = ether('5');
            await expectRevert(
                this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 }),
                "pool not open"
            );
            await time.increase(time.duration.hours(1));
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN(1));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN(0));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(ether('0.5'));

            amount0 = ether('20');
            amount1 = ether('20');
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(ether('1'));

            amount0 = ether('0.1');
            amount1 = ether('0.05');
            await expectRevert(
                this.sb.bid(index, amount0, amount1, { from: bidder3, value: amount1 }),
                "the bid amount is lower than minimum ETH"
            );

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('0'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10020'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('20'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('20'));
        });

        it('when bid ERC20/ETH 2', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('10');
            let amount1 = ether('10');
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(ether('1'));

            amount0 = ether('40');
            amount1 = ether('20');
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(ether('0.5'));

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10010'));
            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('10'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10010'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('5'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('15'));
        });

        it('when bid ERC20/ETH 3', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('2');
            let amount1 = ether('5');
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(ether('2.5'));

            amount0 = ether('6');
            amount1 = ether('3');
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(ether('0.5'));

            amount0 = ether('10');
            amount1 = ether('30');
            await this.sb.bid(index, amount0, amount1, { from: bidder3, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder3)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder3, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder3, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder3, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('3'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderListP(index, 2)).to.be.bignumber.equal(bidder3);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderPositionListP(index, 2)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder3, index)).to.be.bignumber.equal(ether('3'));

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10002'));
            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('2'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('5'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10006'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('6'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('3'));

            expect(await this.sb.myClaimedP(bidder3, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder3 });
            expect(await this.sb.myClaimedP(bidder3, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder3)).to.be.bignumber.equal(ether('10010'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder3, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('30'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9982'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('18'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('38'));
        });

        it('when no bid', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            await time.increase(time.duration.days(1));
            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('10000'));
            let filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('0'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(ether('0'));
        });
    });

    describe('create sealed bid pool ERC20/USDT', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = this.usdToken.address;
            const amountTotal0 = ether('20');
            const amountMin1 = usd('10');
            const duration = 86400;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const minEthPerWallet = usd('0.1');
            const index = 0;
            const createReq = [
                name, creator, token0, token1, amountTotal0, amountMin1, duration, openAt, onlyBot, minEthPerWallet
            ];
            await this.erc20Token.approve(this.sb.address, amountTotal0, { from: creator });
            await this.sb.create(createReq, [], { from: creator });
            const pool = await this.sb.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountMin1).to.be.bignumber.equal(amountMin1);
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.gt(new BN(duration));
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10000'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('10000'));
        });

        it('when bid ERC20/USDT 1', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('10');
            let amount1 = usd('5');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder1 });
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN(1));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN(0));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(usd('0.5'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9995'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10005'));

            amount0 = ether('20');
            amount1 = usd('20');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder2 });
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(usd('1'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9980'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10025'));

            amount0 = ether('0.1');
            amount1 = usd('0.05');
            await expectRevert(
                this.sb.bid(index, amount0, amount1, { from: bidder3, value: amount1 }),
                "the bid amount is lower than minimum ETH"
            );

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10000'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('10000'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10020'));

            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('0'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10020'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9980'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10020'));

            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('20'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10020'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10000'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('20'));
        });

        it('when bid ERC20/USDT 2', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('10');
            let amount1 = usd('10');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder1 });
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(usd('1'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9990'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10010'));

            amount0 = ether('40');
            amount1 = usd('20');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder2 });
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(usd('0.5'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9980'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10030'));

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10010'));
            expect(await this.usdToken.balanceOf(bidder1)).to.be.bignumber.equal(usd('9990'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10030'));
            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('10'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10010'));
            expect(await this.usdToken.balanceOf(bidder2)).to.be.bignumber.equal(usd('9995'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10015'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('5'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9980'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10015'));
            expect(await this.usdToken.balanceOf(this.sb.address)).to.be.bignumber.equal(usd('10000'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('20'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('15'));
        });

        it('when bid ERC20/USDT 3', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            let amount0 = ether('2');
            let amount1 = usd('5');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder1 });
            await this.sb.bid(index, amount0, amount1, { from: bidder1, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder1)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder1, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder1, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder1, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.myPrice(bidder1, index)).to.be.bignumber.equal(usd('2.5'));

            amount0 = ether('6');
            amount1 = usd('3');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder2 });
            await this.sb.bid(index, amount0, amount1, { from: bidder2, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder2)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder2, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder2, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder2, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder2, index)).to.be.bignumber.equal(usd('0.5'));

            amount0 = ether('10');
            amount1 = usd('30');
            await this.usdToken.approve(this.sb.address, amount1, { from: bidder3 });
            await this.sb.bid(index, amount0, amount1, { from: bidder3, value: amount1 });
            expect(await this.sb.getMyBidCount(bidder3)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.myBidP(bidder3, 0)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myAmountBid0P(bidder3, index)).to.be.bignumber.equal(amount0);
            expect(await this.sb.myAmountBid1P(bidder3, index)).to.be.bignumber.equal(amount1);
            expect(await this.sb.getBidderListCount(index)).to.be.bignumber.equal(new BN('3'));
            expect(await this.sb.bidderListP(index, 0)).to.be.bignumber.equal(bidder1);
            expect(await this.sb.bidderListP(index, 1)).to.be.bignumber.equal(bidder2);
            expect(await this.sb.bidderListP(index, 2)).to.be.bignumber.equal(bidder3);
            expect(await this.sb.bidderListHeaderP(index)).to.be.bignumber.equal(new BN('2'));
            expect(await this.sb.bidderPositionListP(index, 0)).to.be.bignumber.equal(new BN('1'));
            expect(await this.sb.bidderPositionListP(index, 1)).to.be.bignumber.equal(MAX_UINT256);
            expect(await this.sb.bidderPositionListP(index, 2)).to.be.bignumber.equal(new BN('0'));
            expect(await this.sb.myPrice(bidder3, index)).to.be.bignumber.equal(usd('3'));

            await time.increase(time.duration.days(1));

            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder1 });
            expect(await this.sb.myClaimedP(bidder1, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder1)).to.be.bignumber.equal(ether('10002'));
            let filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('2'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('5'));

            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder2 });
            expect(await this.sb.myClaimedP(bidder2, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder2)).to.be.bignumber.equal(ether('10006'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder2, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('6'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('3'));

            expect(await this.sb.myClaimedP(bidder3, index)).to.equal(false);
            await this.sb.bidderClaim(index, { from: bidder3 });
            expect(await this.sb.myClaimedP(bidder3, index)).to.equal(true);
            expect(await this.erc20Token.balanceOf(bidder3)).to.be.bignumber.equal(ether('10010'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder3, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('10'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('30'));

            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9982'));
            filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('18'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('38'));
        });

        it('when no bid', async function () {
            await time.increase(time.duration.hours(1));
            const index = 0;
            await time.increase(time.duration.days(1));
            expect(await this.sb.creatorClaimedP(index)).to.equal(false);
            await this.sb.creatorClaim(index, { from: creator });
            expect(await this.sb.creatorClaimedP(index)).to.equal(true);
            expect(await this.sb.myCreatedP(creator)).to.be.bignumber.equal(new BN('0'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('10000'));
            let filledAmounts = await this.sb.creatorFilledAmount(index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('0'));
            filledAmounts = await this.sb.bidderFilledAmount(bidder1, index);
            expect(filledAmounts[0]).to.be.bignumber.equal(ether('0'));
            expect(filledAmounts[1]).to.be.bignumber.equal(usd('0'));
        });
    });
});
