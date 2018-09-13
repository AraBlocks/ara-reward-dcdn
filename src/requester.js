/* eslint class-methods-use-this: 1 */
const { messages, RequesterBase, duplex, util } = require('ara-farming-protocol')
const { createSwarm } = require('ara-network/discovery')
const { info, warn } = require('ara-console')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')
const {
  idify, nonceString, bytesToGBs, weiToEther
} = util
const { FarmerConnection } = duplex

class Requester extends RequesterBase {
  constructor(sow, matcher, requesterSig, wallet) {
    super(sow, matcher)
    this.requesterSig = requesterSig
    this.hiredFarmers = new Map()
    this.swarmIdMap = new Map()
    this.deliveryMap = new Map()
    this.receipts = 0
    this.wallet = wallet
  }

  async broadcastService(afs, contentSwarm) {
    info('Requesting: ', afs.did)

    this.setupContentSwarm(afs, contentSwarm)

    this.peerSwarm = createSwarm()
    this.peerSwarm.on('connection', handleConnection)
    this.peerSwarm.join(afs.did)
    const self = this
    function handleConnection(connection, peer) {
      info(`SWARM: New peer: ${idify(peer.host, peer.port)}`)
      const farmerConnection = new FarmerConnection(peer, connection, { timeout: 6000 })
      process.nextTick(() => self.addFarmer(farmerConnection))
    }
  }

  async setupContentSwarm(afs, swarm) {
    this.contentSwarm = swarm
    this.afs = afs

    const self = this
    let oldByteLength = 0
    const { content } = afs.partitions.resolve(afs.HOME)
    let stakeSubmitted = false

    if (content) {
      // TODO: calc current downloaded size in bytes
      oldByteLength = 0
      attachDownloadListener(content)
    } else {
      afs.once('content', () => {
        attachDownloadListener(afs.partitions.resolve(afs.HOME).content)
      })
    }

    this.contentSwarm.on('connection', handleConnection)

    // Handle when the content needs updated
    async function attachDownloadListener(feed) {
      // Calculate and submit stake
      // NOTE: this is a hack to get content size and should be done prior to download
      feed.once('download', () => {
        debug(`old size: ${oldByteLength}, new size: ${feed.byteLength}`)
        const sizeDelta = feed.byteLength - oldByteLength
        const amount = self.matcher.maxCost * sizeDelta
        info(`Staking ${amount} for a size delta of ${bytesToGBs(sizeDelta)} GBs`)
        self.submitStake(afs.did, amount, (err) => {
          if (err) stopService(err)
          else stakeSubmitted = true
        })
      })

      // Record download data
      feed.on('download', (index, data, from) => {
        const peerIdHex = from.remoteId.toString('hex')
        self.dataReceived(peerIdHex, data.length)
      })

      // Handle when the content finishes downloading
      feed.once('sync', async () => {
        debug("Files:", await afs.readdir('.'))
        self.sendRewards(afs.did)
      })
    }

    async function handleConnection(connection, peer) {
      const contentSwarmId = connection.remoteId.toString('hex')
      const connectionId = idify(peer.host, peer.port)
      self.swarmIdMap.set(contentSwarmId, connectionId)
      info(`Content Swarm: Peer connected: ${connectionId}`)
    }
  }

  async stopService(err){
    debug('Service Complete')
    if (err) debug(`Completion Error: ${err}`)
    this.emit('complete', err)
    if (this.contentSwarm) this.contentSwarm.destroy()
    if (this.peerSwarm) this.peerSwarm.destroy()
    if (this.afs) this.afs.close()
  }

  // Submit the stake to the blockchain
  async submitStake(contentDid, amount, onComplete) {
    const jobId = nonceString(this.sow)
    this.wallet
      .submitJob(contentDid, jobId, amount)
      .then(() => {
        onComplete()
      })
      .catch((err) => {
        onComplete(err)
      })
  }

  async validateQuote(quote) {
    if (quote) return true
    return false
  }

  async generateAgreement(quote) {
    const agreement = new messages.Agreement()
    agreement.setNonce(crypto.randomBytes(32))
    agreement.setQuote(quote)
    agreement.setRequesterSignature(this.requesterSig)
    return agreement
  }

  async validateAgreement(agreement) {
    if (agreement) return true
    return false
  }

  async onHireConfirmed(agreement, connection) {
    const { peer } = connection

    // Extract port
    const data = Buffer.from(agreement.getData())
    const port = data.readUInt32LE(0)

    // Store hired farmer
    const peerId = idify(peer.host, port)
    this.hiredFarmers.set(peerId, { connection, agreement })

    // Start work
    this.startWork(peer, port)
  }

  // Handle when ready to start work
  async startWork(peer, port) {
    const connectionId = idify(peer.host, port)
    debug(`Starting AFS Connection with ${connectionId}`)
    this.contentSwarm.addPeer(this.afs.did, { id: connectionId, host: peer.host, port })
  }

  async onReceipt(receipt, connection) {
    // Expects receipt from all rewarded farmers
    if (receipt && connection) {
      this.incrementOnComplete()
    }
  }

  dataReceived(peerSwarmId, units) {
    if (this.deliveryMap.has(peerSwarmId)) {
      const total = this.deliveryMap.get(peerSwarmId) + units
      this.deliveryMap.set(peerSwarmId, total)
    } else {
      this.deliveryMap.set(peerSwarmId, units)
    }
  }

  sendRewards(contentId) {
    let farmers = []
    let rewards = []
    let rewardMap = new Map()
    const jobId = nonceString(this.sow)

    this.deliveryMap.forEach((value, key) => {
      const peerId = this.swarmIdMap.get(key)
      const units = value
      if (units > 0 && this.hiredFarmers.has(peerId)) {
        const {connection, reward, amount} = this.generateReward(peerId, units)
        farmers.push(peerId)
        rewards.push(reward.getAmount())
        rewardMap.set(peerId, {connection, reward})
      } else {
        debug(`Farmer ${peerId} will not be rewarded.`)
        this.incrementOnComplete()
      }
    })

    this.wallet
      .submitReward(contentId, jobId, farmers, rewards)
      .then(() => {
        rewardMap.forEach((value, key) => {
          value.connection.sendReward(connection.reward)
        }
      })
      .catch((err) => {
        warn(`Failed to submit the reward to for job ${jobId}`)
        debug(err)
      })

  }

  incrementOnComplete() {
    this.receipts++
    if (this.receipts === this.deliveryMap.size) {
      this.stopService()
    }
  }

  // /**
  //  * Awards farmer for their work
  //  */
  // awardFarmer(peerId, units) {
  //   const { connection, agreement } = this.hiredFarmers.get(peerId)
  //   const reward = this.generateReward(agreement, units)
  //   return {connection, reward, amount}
  // }

  /**
   * Calculates farmer reward
   * @param {messages.ARAid} farmer
   * @param {messages.Agreement} agreement
   * @returns {messages.Reward}
   */
  generateReward(peerId, units) {
    const { connection, agreement } = this.hiredFarmers.get(peerId)
    const quote = agreement.getQuote()
    const amount = quote.getPerUnitCost() * units
    const reward = new messages.Reward()
    reward.setNonce(crypto.randomBytes(32))
    reward.setAgreement(agreement)
    reward.setAmount(amount)
    return {connection, reward}
  }

  /**
   * Submits a reward to the contract, and notifies the farmer that their reward is available for withdraw
   */
  // sendReward(connection, reward) {
  //   const quote = reward.getAgreement().getQuote()
  //   const sowId = nonceString(quote.getSow())
  //   const farmerId = quote.getFarmer().getDid()
  //   const amount = reward.getAmount()
  //   info(`Sending reward to farmer ${farmerId} for ${amount} tokens`)
    // this.wallet
    //   .submitReward(sowId, farmerId, amount)
    //   .then(() => {
    //     connection.sendReward(reward)
    //   })
    //   .catch((err) => {
    //     warn(`Failed to submit the reward to farmer ${farmerId} for job ${sowId}`)
    //     debug(err)
    //   })
  }
}

module.exports = { Requester }
