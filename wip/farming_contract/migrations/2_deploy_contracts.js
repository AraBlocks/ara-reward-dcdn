/* eslint no-undef: "off" */

const Farming = artifacts.require('./Farming.sol')

module.exports = function (deployer) {
  deployer.deploy(Farming)
}
