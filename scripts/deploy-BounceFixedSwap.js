const { ethers, upgrades } = require("hardhat");

async function main() {
    const BounceFixedSwap = await ethers.getContractFactory("BounceFixedSwap");
    const contract = await upgrades.deployProxy(BounceFixedSwap, [], 'initialize');
    await contract.deployed();

    console.log("BounceFixedSwap deployed to:", contract.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
