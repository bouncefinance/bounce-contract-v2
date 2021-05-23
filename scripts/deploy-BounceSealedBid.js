const { ethers, upgrades } = require("hardhat");

async function main() {
    const BounceSealedBid = await ethers.getContractFactory("BounceSealedBid");
    const contract = await upgrades.deployProxy(BounceSealedBid, [], 'initialize');
    await contract.deployed();

    console.log("BounceSealedBid deployed to:", contract.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
