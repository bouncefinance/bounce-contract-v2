const { ethers, upgrades } = require("hardhat");

async function main() {
    const BounceDutchAuction = await ethers.getContractFactory("BounceDutchAuction");
    const contract = await upgrades.deployProxy(BounceDutchAuction, [], 'initialize');
    await contract.deployed();

    console.log("BounceDutchAuction deployed to:", contract.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
