// Load dependencies
const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = constants;

// Load compiled artifacts
const BounceFixedSwap = contract.fromArtifact('BounceFixedSwap');
const ERC20 = contract.fromArtifact('@openzeppelin/contracts/ERC20PresetMinterPauser');
const USDT = contract.fromArtifact(require('path').resolve('test/TetherToken'));
const BounceStake = contract.fromArtifact(require('path').resolve('test/BounceStakeSimple'));

function usd (n) {
    return ether(n).div(new BN('10').pow(new BN('12')));
}

// Start test block
describe('BounceFixedSwap', function () {
    const [ owner, governor, creator, buyer, buyer2 ] = accounts;

    beforeEach(async function () {
        // Deploy BounceFixedSwap contract for each test
        this.fs = await BounceFixedSwap.new({ from: owner });
        // Deploy Bounce Stake contract for each test
        this.bounceStake = await BounceStake.new({ from: owner });

        // Deploy a ERC20 contract for each test
        this.erc20Token = await ERC20.new('Bounce Token', 'BOT', { from: owner });
        this.usdToken = await USDT.new(usd('500000'), 'USD Token', 'USDT', 6, { from: owner });

        // initialize Bounce contract
        await this.fs.initialize({ from: owner });
        await expectRevert(this.fs.initialize({ from: owner }), 'Contract instance has already been initialized');
        await this.fs.setConfig(web3.utils.fromAscii("BotToken"), this.erc20Token.address, { from: owner });
        await this.fs.setConfig(web3.utils.fromAscii("StakeContract"), this.bounceStake.address, { from: owner });
        await expectRevert.unspecified(this.fs.setConfig(web3.utils.fromAscii("TxFeeRatio"), ether('0.015'), { from: governor }));
        await expectRevert.unspecified(this.fs.transferOwnership(governor, { from: governor }));
        await this.fs.transferOwnership(governor, { from: owner });
        await expectRevert.unspecified(this.fs.setConfig(web3.utils.fromAscii("TxFeeRatio"), ether('0.015'), { from: owner }));
        expect(await this.fs.getTxFeeRatio()).to.be.bignumber.equal(ether('0.015'));
        expect(await this.fs.getMinValueOfBotHolder()).to.be.bignumber.equal(ether('60'));
        expect(await this.fs.getBotToken()).to.equal(this.erc20Token.address);
        expect(await this.fs.getStakeContract()).to.equal(this.bounceStake.address);

        // mint ERC20 token
        await this.erc20Token.mint(owner,  ether('10000'), { from: owner });
        await this.erc20Token.mint(this.fs.address, ether('10000'), { from: owner });
        await this.erc20Token.mint(creator, ether('10000'), { from: owner });
        await this.erc20Token.mint(buyer, ether('10000'), { from: owner });
        await this.erc20Token.mint(buyer2, ether('10000'), { from: owner });

        // mint USD token
        await this.usdToken.transfer(owner, usd('10000'), { from: owner });
        await this.usdToken.transfer(this.fs.address, usd('10000'), { from: owner });
        await this.usdToken.transfer(creator, usd('10000'), { from: owner });
        await this.usdToken.transfer(buyer, usd('10000'), { from: owner });
        await this.usdToken.transfer(buyer2, usd('10000'), { from: owner });
    });

    it('when create with whitelist should be ok', async function () {
        const name = 'Auction';
        const token0 = this.erc20Token.address;
        const token1 = ZERO_ADDRESS;
        const amountTotal0 = ether('10');
        const amountTotal1 = ether('20');
        const openAt = (await time.latest()).add(time.duration.hours(1));
        const closeAt = openAt.add(time.duration.hours(10));
        const claimAt = closeAt.add(time.duration.hours(1));
        const onlyBot = true;
        const maxAmount1PerWallet = ether('100');
        const enableWhiteList = true;
        let whitelist = [];
        for (let i = 0; i < 250; i++) {
            whitelist.push(web3.utils.randomHex(20));
        }
        whitelist.push(buyer);
        const createReq = [
            name, token0, token1, amountTotal0, amountTotal1, openAt, closeAt,
            claimAt, maxAmount1PerWallet, onlyBot, enableWhiteList
        ];
        const index = 0;
        await this.erc20Token.approve(this.fs.address, amountTotal0, { from: creator });
        let before = await web3.eth.getBalance(creator);
        await this.fs.create(createReq, whitelist, { from: creator, gasPrice: 100e9 });
        let after = await web3.eth.getBalance(creator);
        console.log(`create with 250 whitelist accounts gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`);

        await time.increase(time.duration.hours(1));
        const amount1 = ether('0.1');
        await this.fs.swap(index, amount1, { from: buyer, value: amount1 });
        await expectRevert(
            this.fs.swap(index, amount1, { from: buyer2, value: amount1 }),
            'sender not in whitelist'
        );
    });

    describe('create swap pool ERC20/ETH', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = ZERO_ADDRESS;
            const amountTotal0 = ether('10');
            const amountTotal1 = ether('20');
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const closeAt = openAt.add(time.duration.hours(10));
            const claimAt = new BN('0');
            const maxAmount1PerWallet = ether('100');
            const onlyBot = true;
            const enableWhiteList = true;
            const createReq = [
                name, token0, token1, amountTotal0, amountTotal1, openAt, closeAt,
                claimAt, maxAmount1PerWallet, onlyBot, enableWhiteList
            ];
            const index = 0;
            await this.erc20Token.approve(this.fs.address, amountTotal0, { from: creator });
            await this.fs.create(createReq, [buyer], { from: creator });
            const pool = await this.fs.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountTotal1).to.be.bignumber.equal(amountTotal1);
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.equal(closeAt);
            expect(pool.claimAt).to.be.bignumber.equal(claimAt);
            expect(pool.enableWhiteList).to.equal(enableWhiteList);
            expect(await this.fs.onlyBotHolderP(index)).to.equal(onlyBot);
            expect(await this.fs.maxAmount1PerWalletP(index)).to.be.bignumber.equal(maxAmount1PerWallet);
            expect(await this.fs.getPoolCount()).to.be.bignumber.equal(new BN('1'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10010'));
        });

        it('when swap ERC20/ETH should be ok', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = ether('10');
            const index = 0;
            const beforeBuyer = await web3.eth.getBalance(buyer);
            const beforeBeneficiary = await web3.eth.getBalance(creator);
            await this.fs.swap(index, amount1, { from: buyer, value: amount1, gasPrice: 100e9 });
            const afterBuyer = await web3.eth.getBalance(buyer);
            const afterBeneficiary = await web3.eth.getBalance(creator);
            console.log(`Buyer ETH swap: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
            console.log(`Beneficiary ETH swap: ${web3.utils.fromWei(new BN(afterBeneficiary).sub(new BN(beforeBeneficiary)))}`)

            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('10'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005'));
        });

        it('when swap ERC20/ETH less than 1 ether', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = ether('0.1');
            const index = 0;
            await this.fs.swap(index, amount1, { from: buyer, value: amount1 });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('0.05'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('0.1'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10000.05'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10009.95'));
        });

        it('when swap ERC20/ETH exceeded 1', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = ether('50');
            const index = 0;
            await this.fs.swap(index, amount1, { from: buyer, value: amount1 });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('10'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('20'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10010'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));
        });

        it('when swap ERC20/ETH exceeded 2', async function () {
            await time.increase(time.duration.hours(1));
            const amount1_1 = ether('9.999999');
            const index = 0;
            await this.fs.swap(index, amount1_1, { from: buyer, value: amount1_1 });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('4.9999995'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('9.999999'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10004.9999995'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005.0000005'));

            const amount1_2 = ether('10');
            await this.fs.swap(index, amount1_2, { from: buyer, value: amount1_2 });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('9.9999995'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('19.999999'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10009.9999995'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000.0000005'));

            const amount1_3 = ether('1');
            await this.fs.swap(index, amount1_3, { from: buyer, value: amount1_3 });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('10'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('20'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10010'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));

        });

        it('when create twice revert', async function() {
            await time.increase(time.duration.hours(1));
            const token0 = this.erc20Token.address;
            const token1 = this.usdToken.address;
            const amountTotal0 = ether('10');
            const amountTotal1 = ether('20');
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const closeAt = openAt.add(time.duration.hours(10));
            const claimAt = closeAt.add(time.duration.hours(1));
            const onlyBot = true;
            const maxAmount1PerWallet = ether('1');
            const enableWhiteList = false;
            const createReq = [
                token0, token1, amountTotal0, amountTotal1, openAt, closeAt,
                claimAt, onlyBot, maxAmount1PerWallet, enableWhiteList
            ];
            await this.erc20Token.approve(this.fs.address, amountTotal0, { from: creator });
            // await expectRevert(
            //     this.fs.create(createReq, [], { from: creator }),
            //     'a pool has created by this address'
            // );
        });

        it('when swap ERC20/ETH not open should throw exception', async function () {
            const amount1 = ether('10');
            const index = 0;
            await expectRevert(
                this.fs.swap(index, amount1, { from: buyer, value: amount1 }),
                'pool not open.'
            );
        });

        describe('claim pool ERC20/ETH', function () {
            beforeEach(async function () {
                await time.increase(time.duration.hours(1));
                const amount1 = ether('10');
                const index = 0;
                await this.fs.swap(index, amount1, { from: buyer, value: amount1 });
                expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
                expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(ether('10'));
                expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
                expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
                expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005'));
            });

            it('claim should work', async function () {
                let index = 0;
                await expectRevert(
                    this.fs.creatorClaim(index, { from: creator }),
                    'this pool is not closed'
                );
                await time.increase(36000);
                expect(await this.fs.creatorClaimed(creator, index)).to.equal(false);
                await this.fs.creatorClaim(index, { from: creator });
                expect(await this.fs.creatorClaimed(creator, index)).to.equal(true);
                expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9995'));
                expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
                expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));
            });
        });
    });

    describe('create swap pool ERC20/USDT', function () {
        beforeEach(async function () {
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = this.usdToken.address;
            const amountTotal0 = ether('10');
            const amountTotal1 = usd('20');
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const closeAt = openAt.add(time.duration.hours(10));
            const claimAt = new BN('0');
            const maxAmount1PerWallet = ether('0');
            const onlyBot = true;
            const enableWhiteList = true;
            const createReq = [
                name, token0, token1, amountTotal0, amountTotal1, openAt, closeAt,
                claimAt, maxAmount1PerWallet, onlyBot, enableWhiteList
            ];
            const index = 0;
            const whitelist = [buyer];
            await this.erc20Token.approve(this.fs.address, amountTotal0, { from: creator });
            await this.fs.create(createReq, whitelist, { from: creator });
            const pool = await this.fs.pools(index);
            expect(pool.name).to.equal(name);
            expect(pool.creator).to.equal(creator);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(amountTotal0);
            expect(pool.amountTotal1).to.be.bignumber.equal(amountTotal1);
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.equal(closeAt);
            expect(pool.claimAt).to.be.bignumber.equal(claimAt);
            expect(pool.enableWhiteList).to.equal(enableWhiteList);
            expect(await this.fs.onlyBotHolderP(index)).to.equal(onlyBot);
            expect(await this.fs.maxAmount1PerWalletP(index)).to.be.bignumber.equal(maxAmount1PerWallet);
            expect(await this.fs.getPoolCount()).to.be.bignumber.equal(new BN('1'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10000'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10010'));
        });

        it('when swap ERC20/USDT should be ok', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = usd('10');
            const index = 0;
            await this.usdToken.approve(this.fs.address, amount1, { from: buyer });
            const before = await web3.eth.getBalance(buyer);
            await this.fs.swap(index, amount1, { from: buyer, gasPrice: 100e9  });
            const after = await web3.eth.getBalance(buyer);
            console.log(`ERC20/USDT swap gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`)
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('10'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10009.85'));
        });

        it('when swap ERC20/USDT less than 1 ether', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = usd('0.1');
            const index = 0;
            await this.usdToken.approve(this.fs.address, amount1, { from: buyer });
            await this.fs.swap(index, amount1, { from: buyer });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('0.05'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('0.1'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10000.05'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10009.95'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9999.9'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10000.0985'));
        });

        it('when swap ERC20/USDT exceeded 1', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = usd('50');
            const index = 0;
            await this.usdToken.approve(this.fs.address, amount1, { from: buyer });
            await this.fs.swap(index, amount1, { from: buyer });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('10'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('20'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10010'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9980'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10019.7'));
        });

        it('when swap ERC20/USDT exceeded 2', async function () {
            await time.increase(time.duration.hours(1));
            const amount1_1 = usd('9.999999');
            const index = 0;
            await this.usdToken.approve(this.fs.address, amount1_1, { from: buyer });
            await this.fs.swap(index, amount1_1, { from: buyer });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('4.9999995'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('9.999999'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10004.9999995'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005.0000005'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990.000001'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10009.85'));

            const amount1_2 = usd('10');
            await this.usdToken.approve(this.fs.address, amount1_2, { from: buyer });
            await this.fs.swap(index, amount1_2, { from: buyer });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('9.9999995'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('19.999999'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10009.9999995'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000.0000005'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9980.000001'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10019.7'));

            const amount1_3 = usd('1');
            await this.usdToken.approve(this.fs.address, amount1_3, { from: buyer });
            await this.fs.swap(index, amount1_3, { from: buyer });
            expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('10'));
            expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('20'));
            expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
            expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10010'));
            expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9980'));
            expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10019.700001'));
        });

        it('when create twice', async function() {
            await time.increase(time.duration.hours(1));
            const name = 'Auction';
            const token0 = this.erc20Token.address;
            const token1 = this.usdToken.address;
            const amountTotal0 = ether('10');
            const amountTotal1 = usd('20');
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const closeAt = openAt.add(time.duration.hours(10));
            const claimAt = closeAt.add(time.duration.hours(1));
            const maxAmount1PerWallet = ether('10');
            const onlyBot = true;
            const enableWhiteList = false;
            const createReq = [
                name, token0, token1, amountTotal0, amountTotal1, openAt, closeAt,
                claimAt, maxAmount1PerWallet, onlyBot, enableWhiteList
            ];
            await this.erc20Token.approve(this.fs.address, amountTotal0, { from: creator });
            this.fs.create(createReq, [], { from: creator });
            this.fs.create(createReq, [], { from: creator });
            expect(await this.fs.getPoolCount()).to.be.bignumber.equal(new BN('2'));
        });

        it('when swap ERC20/USDT not open should throw exception', async function () {
            const amount1 = usd('10');
            const index = 0;
            await expectRevert(
                this.fs.swap(index, amount1, { from: buyer }),
                'pool not open.'
            );
        });

        describe('claim pool ERC20/USDT', function () {
            beforeEach(async function () {
                await time.increase(time.duration.hours(1));
                const amount1 = usd('10');
                const index = 0;
                await this.usdToken.approve(this.fs.address, amount1, { from: buyer });
                await this.fs.swap(index, amount1, { from: buyer });
                expect(await this.fs.amountSwap0P(index)).to.be.bignumber.equal(ether('5'));
                expect(await this.fs.amountSwap1P(index)).to.be.bignumber.equal(usd('10'));
                expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9990'));
                expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
                expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10005'));
                expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990'));
                expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10009.85'));
            });

            it('claim should work', async function () {
                let index = 0;
                await expectRevert(
                    this.fs.creatorClaim(index, { from: creator }),
                    'this pool is not closed'
                );
                await time.increase(36000);
                expect(await this.fs.creatorClaimed(creator, index)).to.equal(false);

                let before = await web3.eth.getBalance(creator);
                await this.fs.creatorClaim(index, { from: creator, gasPrice: 100e9 });
                let after = await web3.eth.getBalance(creator);
                console.log(`ERC20/USDT claim gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`);
                expect(await this.fs.creatorClaimed(creator, index)).to.equal(true);
                expect(await this.erc20Token.balanceOf(creator)).to.be.bignumber.equal(ether('9995'));
                expect(await this.erc20Token.balanceOf(buyer)).to.be.bignumber.equal(ether('10005'));
                expect(await this.erc20Token.balanceOf(this.fs.address)).to.be.bignumber.equal(ether('10000'));
                expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990'));
                expect(await this.usdToken.balanceOf(creator)).to.be.bignumber.equal(usd('10009.85'));
            });
        });
    });

});
