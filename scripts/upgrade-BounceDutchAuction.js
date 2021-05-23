const {ethers, upgrades} = require("hardhat");

async function main() {
    const BounceDutchAuction = await ethers.getContractFactory("BounceDutchAuction");
    const proxyAddress = '';
    const contract = await upgrades.upgradeProxy(proxyAddress, BounceDutchAuction);
    console.log("BounceDutchAuction upgraded at: ", contract.address);
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
