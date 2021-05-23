const {ethers, upgrades} = require("hardhat");

async function main() {
    const BounceFixedSwap = await ethers.getContractFactory("BounceNFT");
    const proxyAddress = '';
    const fs = await upgrades.upgradeProxy(proxyAddress, BounceFixedSwap);
    console.log("BounceFixedSwap upgraded at: ", fs.address);
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
