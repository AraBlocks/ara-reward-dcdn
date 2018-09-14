const { purchase } = require('ara-contracts')
const { submit, allocate, redeem } = require('ara-contracts/rewards')

class Wallet {
  constructor(did, password) {
    this.userDiD = did
    this.password = password
  }

  submitJob(contentDid, jobId, budget) {
    return submit({
      requesterDid: this.userDiD,
      password: this.password,
      contentDid,
      job: {
        jobId,
        budget
      }
    })
  }

  submitRewards(contentDid, jobId, farmers, rewards) {
    return allocate({
      requesterDid: this.userDiD,
      password: this.password,
      contentDid,
      job: {
        jobId,
        farmers,
        rewards
      }
    })
  }

  claimReward(contentDid) {
    return redeem({
      requesterDid: this.userDiD,
      password: this.password,
      contentDid
    })
  }
}

function maskHex(hex) {
  return `0x${hex}`
}

module.exports = Wallet
