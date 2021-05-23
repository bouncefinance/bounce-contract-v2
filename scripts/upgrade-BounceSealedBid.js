const {ethers, upgrades} = require("hardhat");

async function main() {
    const BounceSealedBid = await ethers.getContractFactory("BounceSealedBid");
    const proxyAddress = '';
    const contract = await upgrades.upgradeProxy(proxyAddress, BounceSealedBid);
    console.log("BounceSealedBid upgraded at: ", contract.address);
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
