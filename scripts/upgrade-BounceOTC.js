const {ethers, upgrades} = require("hardhat");

async function main() {
    const BounceOTC = await ethers.getContractFactory("BounceOTC");
    const proxyAddress = '';
    const contract = await upgrades.upgradeProxy(proxyAddress, BounceOTC);
    console.log("BounceOTC upgraded at: ", contract.address);
}


main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
