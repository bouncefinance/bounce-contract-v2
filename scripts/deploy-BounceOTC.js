const { ethers, upgrades } = require("hardhat");

async function main() {
    const OTC = await ethers.getContractFactory("BounceOTC");
    const contract = await upgrades.deployProxy(OTC, [], 'initialize');
    await contract.deployed();

    console.log("OTC deployed to:", contract.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
