const { submit, allocate } = require('ara-contracts/rewards')
const { ethify } = require('ara-util/web3')

class Wallet {
  constructor(did, password) {
    this.userDid = did
    this.password = password
  }

  submitJob(contentDid, jobId, budget) {
    return submit({
      requesterDid: this.userDid,
      password: this.password,
      contentDid,
      job: {
        jobId: ethify(jobId),
        budget
      }
    })
  }

  submitRewards(contentDid, jobId, farmers, rewards) {
    return allocate({
      requesterDid: this.userDid,
      password: this.password,
      contentDid,
      job: {
        jobId: ethify(jobId),
        farmers,
        rewards
      }
    })
  }
}

module.exports = { 
  Wallet
}
