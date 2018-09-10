const Web3 = require('web3')
const { abi } = require('./build/contracts/Farming.json')
const rc = require('ara-runtime-configuration')()

class ContractABI {
  constructor(contractAdd, walletAdd) {
    const web3 = new Web3(new Web3.providers.HttpProvider(rc.web3.provider))
    this.wallet = walletAdd
    this.contract = new web3.eth.Contract(abi, contractAdd)
  }

  // Budget in Wei
  submitJob(jobId, budget) {
    return this.contract.methods.submitJob(maskHex(jobId)).send({
      from: this.wallet,
      value: `${budget}`
    })
  }

  // Reward in Wei
  submitReward(jobId, farmerId, reward) {
    return this.contract.methods
      .submitReward(maskHex(jobId), maskHex(farmerId), reward)
      .send({ from: this.wallet })
  }

  claimReward(jobId, farmerId) {
    return this.contract.methods
      .claimReward(maskHex(jobId), maskHex(farmerId))
      .send({ from: this.wallet })
  }
}

function maskHex(hex) {
  return `0x${hex}`
}

module.exports = ContractABI
