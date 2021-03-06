const {ethers, upgrades} = require("hardhat");

async function main() {
    const BounceFixedSwap = await ethers.getContractFactory("BounceFixedSwap");
    const proxyAddress = '';
    const contract = await upgrades.upgradeProxy(proxyAddress, BounceFixedSwap);
    console.log("BounceFixedSwap upgraded at: ", contract.address);
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
