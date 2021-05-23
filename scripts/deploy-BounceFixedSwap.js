const { ethers, upgrades } = require("hardhat");

async function main() {
    const [ owner ] = await ethers.getSigners();
    const BounceFixedSwap = await ethers.getContractFactory("BounceFixedSwap");
    const fs = await upgrades.deployProxy(BounceFixedSwap, [], 'initialize');
    await fs.deployed();

    console.log("BounceFixedSwap deployed to:", fs.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
