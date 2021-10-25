const { ethers, upgrades } = require("hardhat");

async function main() {
    const OTC = await ethers.getContractFactory("BounceOTC");

    const txFeeRatio = ethers.utils.parseEther('0.005'); // 0.5%
    const minBotHolder = ethers.utils.parseEther('60');

    // // eth
    // const botToken = '0xA9B1Eb5908CfC3cdf91F9B8B3a74108598009096'; // AUCTION
    // const stakeContract = '0x98945BC69A554F8b129b09aC8AfDc2cc2431c48E';
    //
    // // bsc
    // const botToken = '0x1188d953aFC697C031851169EEf640F23ac8529C'; // AUCTION
    // const stakeContract = '0x1dd665ba1591756aa87157F082F175bDcA9fB91a';
    //
    // // rinkeby
    // const botToken = '0x5E26FA0FE067d28aae8aFf2fB85Ac2E693BD9EfA'; // AUCTION
    // const stakeContract = '0xa77A9FcbA2Ae5599e0054369d1655D186020ECE1';

    // polygon
    const botToken = ethers.constants.AddressZero;
    const stakeContract = '0xc6a34b2bf59baF984884A0cf4C84eD1541E710d7';

    const contract = await upgrades.deployProxy(OTC, [
        txFeeRatio, minBotHolder, botToken, stakeContract
    ], 'initialize');
    await contract.deployed();

    console.log("OTC deployed to:", contract.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
