// Load dependencies
const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = constants;

// Load compiled artifacts
const BounceLottery = contract.fromArtifact('BounceLottery');
const ERC20 = contract.fromArtifact('@openzeppelin/contracts/ERC20PresetMinterPauser');
const USDT = contract.fromArtifact(require('path').resolve('test/TetherToken'));
const BounceAuctionToken = contract.fromArtifact('BounceAuctionToken');
const BounceERC721 = contract.fromArtifact('BounceERC721');
const BounceERC1155 = contract.fromArtifact('BounceERC1155');

function usd (n) {
    return ether(n).div(new BN('10').pow(new BN('12')));
}

// Start test block
describe('Bounce', function () {
    const [ owner, setter, governor, creator, buyer, buyer2, kyc1, kyc2 ] = accounts;

    beforeEach(async function () {
        // Deploy BounceLottery contract for each test
        this.lottery = await BounceLottery.new({ from: owner });

        // Deploy a ERC20 contract for each test
        this.erc20Token = await ERC20.new('Bounce Token', 'BOT', { from: owner });
        this.usdToken = await USDT.new(usd('500000'), 'USD Token', 'USDT', 6, { from: owner });
        this.auctionToken = await BounceAuctionToken.new(this.erc20Token.address, { from: owner });

        // Deploy a BounceERC721 contract for each test
        this.botNFT = await BounceERC721.new( { from: owner });
        this.botNFT.initialize("Bounce NFT", "BNFT", { from: owner });
        // Deploy a BounceERC1155 contract for each test
        this.erc20Token = await BounceERC1155.new('http://example.com', { from: owner });

        // initialize Bounce contract
        await this.lottery.initialize(owner, [creator], { from: owner });
        await expectRevert(this.lottery.initialize(governor, [creator], { from: governor }), 'invalid governor');
        await this.lottery.setConfig(web3.utils.fromAscii("BLNP::BotToken"), this.erc20Token.address, { from: owner });
        await this.lottery.setConfig(web3.utils.fromAscii("BLNP::UsdtToken"), this.usdToken.address, { from: owner });
        await this.lottery.setConfig(web3.utils.fromAscii("BLNP::AuctionToken"), this.auctionToken.address, { from: owner });
        await this.lottery.setConfig(web3.utils.fromAscii("BLNP::BouncePro"), this.bp.address, { from: owner });
        await expectRevert.unspecified(this.lottery.setConfig(web3.utils.fromAscii("BLNP::TxFeeRatio"), ether('0.015'), { from: governor }));
        await expectRevert.unspecified(this.lottery.transferGovernorship(governor, { from: governor }));
        await this.lottery.transferGovernorship(governor, { from: owner });
        await expectRevert.unspecified(this.lottery.setConfig(web3.utils.fromAscii("BLNP::TxFeeRatio"), ether('0.015'), { from: owner }));
        expect(await this.lottery.getTxFeeRatio()).to.be.bignumber.equal(ether('0.015'));
        expect(await this.lottery.getMinValueOfBotHolder()).to.be.bignumber.equal(ether('0.3'));
        expect(await this.lottery.getBotToken()).to.equal(this.erc20Token.address);
        expect(await this.lottery.getUsdtToken()).to.equal(this.usdToken.address);
        expect(await this.lottery.getAuctionToken()).to.equal(this.auctionToken.address);
        expect(await this.lottery.creator(creator)).to.equal(true);

        // mint BOT token
        await this.erc20Token.mint(owner,  ether('10000'), { from: owner });
        await this.erc20Token.mint(this.lottery.address, ether('10000'), { from: owner });
        await this.erc20Token.mint(creator, ether('10000'), { from: owner });
        await this.erc20Token.mint(beneficiary, ether('10000'), { from: owner });
        await this.erc20Token.mint(buyer, ether('10000'), { from: owner });
        await this.erc20Token.mint(buyer2, ether('10000'), { from: owner });
        await this.erc20Token.mint(kyc1, ether('10000'), { from: owner });
        await this.erc20Token.mint(kyc2, ether('10000'), { from: owner });

        // mint USD token
        await this.usdToken.transfer(owner, usd('10000'), { from: owner });
        await this.usdToken.transfer(this.lottery.address, usd('10000'), { from: owner });
        await this.usdToken.transfer(creator, usd('10000'), { from: owner });
        await this.usdToken.transfer(beneficiary, usd('10000'), { from: owner });
        await this.usdToken.transfer(buyer, usd('10000'), { from: owner });
        await this.usdToken.transfer(buyer2, usd('10000'), { from: owner });
        await this.usdToken.transfer(kyc1, usd('10000'), { from: owner });
        await this.usdToken.transfer(kyc2, usd('10000'), { from: owner });

        // mint ERC721 token
        await this.botNFT.mint(beneficiary, 0, { from: owner });
        await this.botNFT.mint(beneficiary, 1, { from: owner });
        await this.botNFT.mint(beneficiary, 2, { from: owner });
        expect(await this.botNFT.ownerOf(0)).to.equal(beneficiary);
        expect(await this.botNFT.ownerOf(1)).to.equal(beneficiary);
        expect(await this.botNFT.ownerOf(2)).to.equal(beneficiary);
        expect(await this.botNFT.balanceOf(beneficiary)).to.be.bignumber.equal(new BN('3'));
        // mint ERC1155 token
        await this.erc20Token.mint(beneficiary, 0, 10000, [], { from: owner });
        await this.erc20Token.mint(beneficiary, 1, 20000, [], { from: owner });
        await this.erc20Token.mint(beneficiary, 2, 30000, [], { from: owner });
        expect(await this.erc20Token.balanceOf(beneficiary, 0)).to.be.bignumber.equal(new BN('10000'));
        expect(await this.erc20Token.balanceOf(beneficiary, 1)).to.bignumber.equal(new BN('20000'));
        expect(await this.erc20Token.balanceOf(beneficiary, 2)).to.bignumber.equal(new BN('30000'));

        await this.lottery.setUniswapV2Router(this.uniswapV2Router02.address, { from: governor });
        expect(await this.lottery.getUniswapV2Router()).to.equal(this.uniswapV2Router02.address);
        let amountTokenDesired = ether('1');
        let amountETHDesired = ether('1');
        let amountTokenMin = ether('1');
        let amountETHMin = ether('1');
        const to = owner;
        const deadline = (await time.latest()).add(time.duration.minutes(20));
        await this.uniswapV2Factory.createPair(this.weth.address, this.erc20Token.address, { from: owner });
        await this.erc20Token.approve(this.uniswapV2Router02.address, amountTokenDesired, { from: owner });
        await this.uniswapV2Router02.addLiquidityETH(
            this.erc20Token.address, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline,
            { from: owner, value: amountETHDesired }
        );

        amountTokenDesired = usd('1');
        amountETHDesired = usd('1');
        await this.uniswapV2Factory.createPair(this.weth.address, this.usdToken.address, { from: owner });
        await this.usdToken.approve(this.uniswapV2Router02.address, amountTokenDesired, { from: owner });
        await this.uniswapV2Router02.addLiquidityETH(
            this.usdToken.address, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline,
            { from: owner, value: amountETHDesired }
        );
    });

    it('when create with whitelist should be ok', async function () {
        const token0 = this.erc20Token.address;
        const tokenId0 = 0;
        const amountTotal0 = 2000;
        const token1 = ZERO_ADDRESS;
        const amount1 = ether('20');
        const nftType = 1;
        const duration = time.duration.hours(1);
        const maxPlayer = 1000;
        const nShare = 300;
        const openAt = (await time.latest()).add(time.duration.hours(1));
        const onlyBot = true;
        const enableWhiteList = true;
        const enableKycList = false;
        let whitelist = [];
        for (let i = 0; i < 250; i++) {
            whitelist.push(web3.utils.randomHex(20));
        }
        whitelist.push(buyer);
        const createReq = [
            beneficiary, token0, tokenId0, amountTotal0, token1, amount1, nftType, maxPlayer, nShare,
            duration, openAt, enableWhiteList, enableKycList, onlyBot
        ];
        await this.erc20Token.approve(this.lottery.address, amountTotal0, { from: creator });
        let before = await web3.eth.getBalance(creator);
        await this.lottery.create(createReq, whitelist, { from: creator, gasPrice: 100e9 });
        let after = await web3.eth.getBalance(creator);
        console.log(`create with 250 whitelist accounts gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`);
    });

    describe('create bet pool ERC1155/ETH', function () {
        beforeEach(async function () {
            const token0 = this.erc20Token.address;
            const tokenId0 = 0;
            const amountTotal0 = 100;
            const token1 = ZERO_ADDRESS;
            const amount1 = ether('10');
            const nftType = 1;
            const duration = time.duration.hours(1);
            const maxPlayer = 50;
            const nShare = 2;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const enableWhiteList = true;
            const enableKycList = true;
            const createReq = [
                beneficiary, token0, tokenId0, amountTotal0, token1, amount1, nftType, maxPlayer, nShare,
                duration, openAt, enableWhiteList, enableKycList, onlyBot
            ];
            const index = 0;
            await this.bp.addKycList([buyer, buyer2, kyc1, kyc2], { from: creator });
            await this.erc20Token.setApprovalForAll(this.lottery.address, true, { from: beneficiary });
            let before = await web3.eth.getBalance(creator);
            await this.lottery.create(createReq, [buyer, buyer2, kyc1, kyc2], { from: creator, gasPrice: 100e9 });
            let after = await web3.eth.getBalance(creator);
            console.log(`create accounts gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`);
            const pool = await this.lottery.pools(index);
            const poolsExt = await this.lottery.poolsExt(index);
            expect(pool.beneficiary).to.equal(beneficiary);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(new BN(amountTotal0));
            expect(pool.tokenId0).to.be.bignumber.equal(new BN(tokenId0));
            expect(pool.amount1).to.be.bignumber.equal(amount1);
            expect(pool.nftType).to.be.bignumber.equal(new BN(nftType));
            expect(pool.maxPlayer).to.be.bignumber.equal(new BN(maxPlayer));
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.equal(openAt.add(duration));
            expect(pool.enableWhiteList).to.equal(enableWhiteList);
            expect(pool.enableKycList).to.equal(enableKycList);
            expect(poolsExt.nShare).to.be.bignumber.equal(new BN(nShare));
            expect(await this.lottery.onlyBotHolderP(index)).to.equal(onlyBot);
            expect(await this.lottery.getPoolCount()).to.be.bignumber.equal(new BN('1'));
            expect(await this.erc20Token.balanceOf(this.lottery.address, tokenId0)).to.be.bignumber.equal(new BN(amountTotal0));
            expect(await this.erc20Token.balanceOf(beneficiary, tokenId0)).to.be.bignumber.equal(new BN('9900'));
        });

        it('when bet ERC1155/ETH should be ok', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = ether('10');
            const index = 0;
            const beforeBuyer = await web3.eth.getBalance(buyer);
            await this.lottery.bet(index, { from: buyer, value: amount1, gasPrice: 100e9 });
            const afterBuyer = await web3.eth.getBalance(buyer);
            console.log(`Buyer ETH bet: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
            expect(await this.lottery.allPlayer(index, buyer)).to.be.bignumber.equal(new BN('1'));
            expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('1'));
        });

        it('when create twice', async function() {
            const token0 = this.erc20Token.address;
            const tokenId0 = 0;
            const amountTotal0 = 2000;
            const token1 = ZERO_ADDRESS;
            const amount1 = ether('10');
            const nftType = 1;
            const duration = time.duration.hours(1);
            const maxPlayer = 1000;
            const nShare = 300;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const enableWhiteList = true;
            const enableKycList = true;
            const createReq = [
                beneficiary, token0, tokenId0, amountTotal0, token1, amount1, nftType, maxPlayer, nShare,
                duration, openAt, enableWhiteList, enableKycList, onlyBot
            ];
            await this.erc20Token.setApprovalForAll(this.lottery.address, true, { from: beneficiary });
            await this.lottery.create(createReq, [buyer], { from: creator, gasPrice: 100e9 });
            await this.lottery.create(createReq, [buyer], { from: creator, gasPrice: 100e9 });
            expect(await this.lottery.getPoolCount()).to.be.bignumber.equal(new BN('3'));
        });

        it('when bet ERC1155/ETH not open should throw exception', async function () {
            const amount1 = ether('10');
            const index = 0;
            await expectRevert(
                this.lottery.bet(index, { from: buyer, value: amount1 }),
                'pool not open.'
            );
        });

        describe('claim pool ERC1155/ETH', function () {
            beforeEach(async function () {
                await time.increase(time.duration.hours(1));
                const amount1 = ether('10');
                const index = 0;
                const beforeBuyer = await web3.eth.getBalance(buyer);
                await this.lottery.bet(index, { from: buyer, value: amount1, gasPrice: 100e9 });
                const afterBuyer = await web3.eth.getBalance(buyer);
                console.log(`Buyer ETH bet: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
                expect(await this.lottery.allPlayer(index, buyer)).to.be.bignumber.equal(new BN('1'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('1'));

                await this.lottery.bet(index, { from: buyer2, value: amount1, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, buyer2)).to.be.bignumber.equal(new BN('2'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('2'));

                await this.lottery.bet(index, { from: kyc1, value: amount1, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, kyc1)).to.be.bignumber.equal(new BN('3'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('3'));

                await this.lottery.bet(index, { from: kyc2, value: amount1, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, kyc2)).to.be.bignumber.equal(new BN('4'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('4'));

                let poolsExt = await this.lottery.poolsExt(index);
                let curPlayer = await this.lottery.curPlayerP(index);
                let lo2 = await this.lottery.lo2(curPlayer);
                console.log(`poolsExt.lastHash: ${poolsExt.lastHash}`);
                console.log(`curPlayer: ${curPlayer}`);
                console.log(`lo2: ${lo2}`);
                for(let i = 0; i < 10; i++) {
                    console.log(`calcRet: ${await this.lottery.calcRet(i, 10)}`);
                }
            });

            it('claim should work', async function () {
                let index = 0;
                await expectRevert(
                    this.lottery.claim(index, { from: beneficiary }),
                    'this pool is not closed'
                );
                await time.increase(time.duration.hours(1));
                expect(await this.lottery.teamClaimed(beneficiary, index)).to.equal(false);
                const beforeBeneficiary = await web3.eth.getBalance(beneficiary);
                let beforeBuyer2 = await web3.eth.getBalance(buyer2);
                await this.lottery.claim(index, { from: buyer2, gasPrice: 100e9 });
                let afterBuyer2 = await web3.eth.getBalance(buyer2);
                const afterBeneficiary = await web3.eth.getBalance(beneficiary);
                console.log(`claim fee: ${web3.utils.fromWei(new BN(beforeBuyer2).sub(new BN(afterBuyer2)))}`)
                console.log(`Beneficiary claim: ${web3.utils.fromWei(new BN(afterBeneficiary).sub(new BN(beforeBeneficiary)))}`)
                expect(await this.lottery.teamClaimed(beneficiary, index)).to.equal(true);
                await expectRevert(
                    this.lottery.claim(index, { from: buyer2 }),
                    'claimed'
                );

                const beforeBuyer = await web3.eth.getBalance(buyer);
                await this.lottery.playerClaim(index, { from: buyer, gasPrice: 100e9 });
                const afterBuyer = await web3.eth.getBalance(buyer);
                await expectRevert(
                    this.lottery.playerClaim(index, { from: buyer }),
                    'You have claimed this pool'
                );
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)

                beforeBuyer2 = await web3.eth.getBalance(buyer2);
                await this.lottery.playerClaim(index, { from: buyer2, gasPrice: 100e9 });
                afterBuyer2 = await web3.eth.getBalance(buyer2);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeBuyer2).sub(new BN(afterBuyer2)))}`)

                const beforeKyc1 = await web3.eth.getBalance(kyc1);
                await this.lottery.playerClaim(index, { from: kyc1, gasPrice: 100e9 });
                const afterKyc1 = await web3.eth.getBalance(kyc1);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeKyc1).sub(new BN(afterKyc1)))}`)

                const beforeKyc2 = await web3.eth.getBalance(kyc2);
                await this.lottery.playerClaim(index, { from: kyc2, gasPrice: 100e9 });
                const afterKyc2 = await web3.eth.getBalance(kyc2);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeKyc2).sub(new BN(afterKyc2)))}`)

                await expectRevert(
                    this.lottery.playerClaim(index, { from: beneficiary }),
                    'You haven\'t bet yet'
                );
            });
        });
    });

    describe('create bet pool ERC1155/USDT', function () {
        beforeEach(async function () {
            const token0 = this.erc20Token.address;
            const tokenId0 = 0;
            const amountTotal0 = 100;
            const token1 = this.usdToken.address;
            const amount1 = usd('10');
            const nftType = 1;
            const duration = time.duration.hours(1);
            const maxPlayer = 50;
            const nShare = 2;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const enableWhiteList = true;
            const enableKycList = true;
            const createReq = [
                beneficiary, token0, tokenId0, amountTotal0, token1, amount1, nftType, maxPlayer, nShare,
                duration, openAt, enableWhiteList, enableKycList, onlyBot
            ];
            const index = 0;
            await this.bp.addKycList([buyer, buyer2, kyc1, kyc2], { from: creator });
            await this.erc20Token.setApprovalForAll(this.lottery.address, true, { from: beneficiary });
            let before = await web3.eth.getBalance(creator);
            await this.lottery.create(createReq, [buyer, buyer2, kyc1, kyc2], { from: creator, gasPrice: 100e9 });
            let after = await web3.eth.getBalance(creator);
            console.log(`create accounts gas fee: ${web3.utils.fromWei(new BN(before).sub(new BN(after)))}`);
            const pool = await this.lottery.pools(index);
            const poolsExt = await this.lottery.poolsExt(index);
            expect(pool.beneficiary).to.equal(beneficiary);
            expect(pool.token0).to.equal(token0);
            expect(pool.token1).to.equal(token1);
            expect(pool.amountTotal0).to.be.bignumber.equal(new BN(amountTotal0));
            expect(pool.tokenId0).to.be.bignumber.equal(new BN(tokenId0));
            expect(pool.amount1).to.be.bignumber.equal(amount1);
            expect(pool.nftType).to.be.bignumber.equal(new BN(nftType));
            expect(pool.maxPlayer).to.be.bignumber.equal(new BN(maxPlayer));
            expect(pool.openAt).to.be.bignumber.equal(openAt);
            expect(pool.closeAt).to.be.bignumber.equal(openAt.add(duration));
            expect(pool.enableWhiteList).to.equal(enableWhiteList);
            expect(pool.enableKycList).to.equal(enableKycList);
            expect(poolsExt.nShare).to.be.bignumber.equal(new BN(nShare));
            expect(await this.lottery.onlyBotHolderP(index)).to.equal(onlyBot);
            expect(await this.lottery.getPoolCount()).to.be.bignumber.equal(new BN('1'));
            expect(await this.erc20Token.balanceOf(this.lottery.address, tokenId0)).to.be.bignumber.equal(new BN(amountTotal0));
            expect(await this.erc20Token.balanceOf(beneficiary, tokenId0)).to.be.bignumber.equal(new BN('9900'));
        });

        it('when bet ERC1155/USDT should be ok', async function () {
            await time.increase(time.duration.hours(1));
            const amount1 = usd('10');
            const index = 0;
            await this.usdToken.approve(this.lottery.address, amount1, { from: buyer });
            const beforeBuyer = await web3.eth.getBalance(buyer);
            await this.lottery.bet(index, { from: buyer, value: amount1, gasPrice: 100e9 });
            const afterBuyer = await web3.eth.getBalance(buyer);
            console.log(`Buyer ETH bet: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
            expect(await this.lottery.allPlayer(index, buyer)).to.be.bignumber.equal(new BN('1'));
            expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('1'));
            expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990'));
        });

        it('when create twice', async function() {
            const token0 = this.erc20Token.address;
            const tokenId0 = 0;
            const amountTotal0 = 2000;
            const token1 = this.usdToken.address;
            const amount1 = ether('10');
            const nftType = 1;
            const duration = time.duration.hours(1);
            const maxPlayer = 1000;
            const nShare = 300;
            const openAt = (await time.latest()).add(time.duration.hours(1));
            const onlyBot = true;
            const enableWhiteList = true;
            const enableKycList = true;
            const createReq = [
                beneficiary, token0, tokenId0, amountTotal0, token1, amount1, nftType, maxPlayer, nShare,
                duration, openAt, enableWhiteList, enableKycList, onlyBot
            ];
            await this.erc20Token.setApprovalForAll(this.lottery.address, true, { from: beneficiary });
            await this.lottery.create(createReq, [buyer], { from: creator, gasPrice: 100e9 });
            await this.lottery.create(createReq, [buyer], { from: creator, gasPrice: 100e9 });
            expect(await this.lottery.getPoolCount()).to.be.bignumber.equal(new BN('3'));
        });

        it('when bet ERC1155/USDT not open should throw exception', async function () {
            const amount1 = ether('10');
            const index = 0;
            await expectRevert(
                this.lottery.bet(index, { from: buyer, value: amount1 }),
                'pool not open.'
            );
        });

        describe('claim pool ERC1155/USDT', function () {
            beforeEach(async function () {
                const index = 0;
                await expectRevert(
                    this.lottery.bet(index, { from: buyer }),
                    'pool not open'
                );
                await time.increase(time.duration.hours(1));
                const amount1 = usd('10');
                await this.usdToken.approve(this.lottery.address, amount1, { from: buyer });
                const beforeBuyer = await web3.eth.getBalance(buyer);
                await this.lottery.bet(index, { from: buyer, gasPrice: 100e9 });
                const afterBuyer = await web3.eth.getBalance(buyer);
                console.log(`Buyer ETH bet: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
                expect(await this.lottery.allPlayer(index, buyer)).to.be.bignumber.equal(new BN('1'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('1'));
                expect(await this.usdToken.balanceOf(buyer)).to.be.bignumber.equal(usd('9990'));

                await this.usdToken.approve(this.lottery.address, amount1, { from: buyer2 });
                await this.lottery.bet(index, { from: buyer2, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, buyer2)).to.be.bignumber.equal(new BN('2'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('2'));
                expect(await this.usdToken.balanceOf(buyer2)).to.be.bignumber.equal(usd('9990'));

                await this.usdToken.approve(this.lottery.address, amount1, { from: kyc1 });
                await this.lottery.bet(index, { from: kyc1, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, kyc1)).to.be.bignumber.equal(new BN('3'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('3'));
                expect(await this.usdToken.balanceOf(kyc1)).to.be.bignumber.equal(usd('9990'));

                await this.usdToken.approve(this.lottery.address, amount1, { from: kyc2 });
                await this.lottery.bet(index, { from: kyc2, gasPrice: 100e9 });
                expect(await this.lottery.allPlayer(index, kyc2)).to.be.bignumber.equal(new BN('4'));
                expect(await this.lottery.curPlayerP(index)).to.be.bignumber.equal(new BN('4'));
                expect(await this.usdToken.balanceOf(kyc2)).to.be.bignumber.equal(usd('9990'));

                let poolsExt = await this.lottery.poolsExt(index);
                let curPlayer = await this.lottery.curPlayerP(index);
                let lo2 = await this.lottery.lo2(curPlayer);
                console.log(`poolsExt.lastHash: ${poolsExt.lastHash}`);
                console.log(`curPlayer: ${curPlayer}`);
                console.log(`lo2: ${lo2}`);
                for(let i = 0; i < 10; i++) {
                    console.log(`calcRet: ${await this.lottery.calcRet(i, 10)}`);
                }
            });

            it('claim should work', async function () {
                let index = 0;
                await expectRevert(
                    this.lottery.claim(index, { from: beneficiary }),
                    'this pool is not closed'
                );
                await time.increase(time.duration.hours(1));
                expect(await this.lottery.teamClaimed(beneficiary, index)).to.equal(false);
                let beforeBuyer2 = await web3.eth.getBalance(buyer2);
                await this.lottery.claim(index, { from: buyer2, gasPrice: 100e9 });
                let afterBuyer2 = await web3.eth.getBalance(buyer2);
                console.log(`claim fee: ${web3.utils.fromWei(new BN(beforeBuyer2).sub(new BN(afterBuyer2)))}`)
                expect(await this.usdToken.balanceOf(beneficiary)).to.be.bignumber.equal(usd('10019.7'));
                expect(await this.lottery.teamClaimed(beneficiary, index)).to.equal(true);
                await expectRevert(
                    this.lottery.claim(index, { from: buyer2 }),
                    'claimed'
                );

                const beforeBuyer = await web3.eth.getBalance(buyer);
                await this.lottery.playerClaim(index, { from: buyer, gasPrice: 100e9 });
                const afterBuyer = await web3.eth.getBalance(buyer);
                await expectRevert(
                    this.lottery.playerClaim(index, { from: buyer }),
                    'You have claimed this pool'
                );
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeBuyer).sub(new BN(afterBuyer)))}`)
                console.log(`buyer result: ${await this.lottery.isWinner(index, buyer)}, usdt: ${await this.usdToken.balanceOf(buyer)}`)

                beforeBuyer2 = await web3.eth.getBalance(buyer2);
                await this.lottery.playerClaim(index, { from: buyer2, gasPrice: 100e9 });
                afterBuyer2 = await web3.eth.getBalance(buyer2);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeBuyer2).sub(new BN(afterBuyer2)))}`)
                console.log(`buyer2 result: ${await this.lottery.isWinner(index, buyer2)}, usdt: ${await this.usdToken.balanceOf(buyer2)}`)

                const beforeKyc1 = await web3.eth.getBalance(kyc1);
                await this.lottery.playerClaim(index, { from: kyc1, gasPrice: 100e9 });
                const afterKyc1 = await web3.eth.getBalance(kyc1);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeKyc1).sub(new BN(afterKyc1)))}`)
                console.log(`kyc1 result: ${await this.lottery.isWinner(index, kyc1)}, usdt: ${await this.usdToken.balanceOf(kyc1)}`)

                const beforeKyc2 = await web3.eth.getBalance(kyc2);
                await this.lottery.playerClaim(index, { from: kyc2, gasPrice: 100e9 });
                const afterKyc2 = await web3.eth.getBalance(kyc2);
                console.log(`player claim fee: ${web3.utils.fromWei(new BN(beforeKyc2).sub(new BN(afterKyc2)))}`)
                console.log(`kyc2 result: ${await this.lottery.isWinner(index, kyc2)}, usdt: ${await this.usdToken.balanceOf(kyc2)}`)

                await expectRevert(
                    this.lottery.playerClaim(index, { from: beneficiary }),
                    'You haven\'t bet yet'
                );
            });
        });
    });
});
