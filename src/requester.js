/* eslint class-methods-use-this: 1 */
const {
  messages, RequesterBase, duplex, util
} = require('ara-farming-protocol')
const { AutoQueue, Countdown } = require('./util')
const { createSwarm } = require('ara-network/discovery')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')

const {
  idify, nonceString, bytesToGBs, weiToEther
} = util
const { FarmerConnection } = duplex

class Requester extends RequesterBase {
  /**
   * Requester replicates an AFS for a sow
   * @param {Wallet} wallet Requester's Wallet
   * @param {AFS} afs Instance of AFS
   */
  constructor(sow, matcher, wallet, afs) {
    super(sow, matcher)
    this.hiredFarmers = new Map()
    this.swarmIdMap = new Map()
    this.deliveryMap = new Map()
    this.wallet = wallet
    this.autoQueue = new AutoQueue(this.stopBroadcast.bind(this))

    this.userID = new messages.AraId()
    this.userID.setDid(wallet.userDid)

    // TODO: actually sign data
    this.requesterSig = new messages.Signature()
    this.requesterSig.setAraId(this.userID)
    this.requesterSig.setData('avalidsignature')

    this.afs = afs
  }

  async startBroadcast() {
    const self = this
    debug('Requesting: ', self.afs.did)

    // TODO: Only download if new data
    // TODO: use Ara rather than ether conversion
    // Calculate and job budget
    const amount = weiToEther(self.matcher.maxCost)
    debug(`Staking ${amount} Ara for AFS ${self.afs.did}`)
    await self.prepareJob(self.afs.did, amount, (err) => {
      if (err) {
        debug(`failed to start broadcast for ${self.afs.did}`, err)
        return
      }
      self.setupContentSwarm()
      self.peerSwarm = createSwarm()
      self.peerSwarm.on('connection', handleConnection)
      self.peerSwarm.join(self.afs.did)
    })

    function handleConnection(connection, peer) {
      debug(`Peer Swarm: Peer connected: ${idify(peer.host, peer.port)}`)
      const farmerConnection = new FarmerConnection(peer, connection, { timeout: 6000 })
      process.nextTick(() => self.addFarmer(farmerConnection))
    }
  }

  async setupContentSwarm() {
    const self = this
    this.contentSwarm = createSwarm({ stream })
    this.contentSwarm.on('connection', handleConnection)

    const { content } = self.afs.partitions.resolve(self.afs.HOME)

    if (content) {
      attachDownloadListener(content)
    } else {
      self.afs.once('content', () => {
        attachDownloadListener(self.afs.partitions.resolve(self.afs.HOME).content)
      })
    }

    // Handle when the content needs updated
    async function attachDownloadListener(feed) {
      // Record download data
      feed.on('download', (index, data, from) => {
        const peerIdHex = from.remoteId.toString('hex')
        self.dataReceived(peerIdHex, data.length)
      })

      // Handle when the content finishes downloading
      feed.once('sync', async () => {
        debug('Files:', await self.afs.readdir('.'))
        self.sendRewards(self.afs.did)
      })
    }

    function stream() {
      const afsstream = self.afs.replicate({
        upload: false,
        download: true
      })
      return afsstream
    }

    async function handleConnection(connection, peer) {
      const contentSwarmId = connection.remoteId.toString('hex')
      const connectionId = idify(peer.host, peer.port)
      self.swarmIdMap.set(contentSwarmId, connectionId)
      debug(`Content Swarm: Peer connected: ${connectionId}`)
    }
  }

  stopBroadcast(err) {
    if (err) debug(`Broadcast Error: ${err}`)
    if (this.contentSwarm) this.contentSwarm.destroy()
    if (this.peerSwarm) this.peerSwarm.destroy()
    debug('Service Stopped')
  }

  // Retrieve or Submit the job to the blockchain
  async prepareJob(contentDid, amount, onReady) {
    const self = this
    const jobId = nonceString(self.sow)
    let currentBudget = 0
    try {
      currentBudget = await this.wallet.getBudget(contentDid, jobId)
      debug(`prepareJob currentBudget is: ${currentBudget}`)
    } catch (err){
      currentBudget = 0
      debug('prepareJob:', err)
    }

    // TODO refactor to use await
    if (currentBudget < amount){
      const transaction = (onComplete) => {
        debug(`Submitting job ${jobId} with budget ${amount} Ara.`)
        self.wallet
          .submitJob(contentDid, jobId, amount)
          .then(() => {
            self.emit('jobcreated', jobId, contentDid)
            debug('Job submitted successfully')
            onReady()
            onComplete()
          })
          .catch((err) => {
            onReady(err)
            onComplete(err)
          })
      }

      this.autoQueue.append(transaction)
    } else {
      onReady()
    }
  }

  async validateQuote(quote) {
    // TODO: Validate DID
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
    this.contentSwarm.addPeer(this.afs.did, { host: peer.host, port })
  }

  async onReceipt(receipt, connection) {
    // Expects receipt from all rewarded farmers
    if (receipt && connection) {
      if (this.receiptCountdown) this.receiptCountdown.decrement()
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
    const self = this
    const farmers = []
    const rewards = []
    const rewardMap = new Map()
    const jobId = nonceString(self.sow)

    // Format rewards for contract
    this.receiptCountdown = new Countdown(this.deliveryMap.size, this.stopBroadcast.bind(this))
    let total = 0
    this.deliveryMap.forEach((value) => { total += value })

    if (0 === total){
      debug('No bytes received. Not sending rewards.')
      return
    }

    this.deliveryMap.forEach((value, key) => {
      const peerId = this.swarmIdMap.get(key)
      const units = value / total
      const reward = this.generateReward(peerId, units)
      const userId = reward.getAgreement().getQuote().getFarmer().getDid()
      // TODO: use Ara
      const amount = weiToEther(reward.getAmount())

      if (amount > 0) {
        farmers.push(userId)
        rewards.push(amount)
        rewardMap.set(peerId, reward)
        debug(`Farmer ${userId} will be rewarded ${amount} Ara.`)
      } else {
        debug(`Farmer ${userId} will not be rewarded.`)
        this.receiptCountdown.decrement()
      }
    })

    const transaction = (onComplete) => {
      debug(`Submitting reward for job ${jobId}.`)
      self.wallet
        .submitRewards(contentId, jobId, farmers, rewards)
        .then(() => {
          self.emit('jobcomplete', jobId)
          rewardMap.forEach((value, key) => {
            const { connection } = self.hiredFarmers.get(key)
            connection.sendReward(value)
          })
          onComplete()
        })
        .catch((err) => {
          debug(`Failed to submit reward for job ${jobId}`)
          debug(err)
          onComplete(err)
        })
    }

    this.autoQueue.append(transaction)
  }

  generateReward(peerId, units) {
    const { agreement } = this.hiredFarmers.get(peerId)
    const quote = agreement.getQuote()
    const amount = Math.floor(quote.getPerUnitCost() * units)
    const reward = new messages.Reward()
    reward.setNonce(crypto.randomBytes(32))
    reward.setAgreement(agreement)
    reward.setAmount(amount)
    return reward
  }
}

module.exports = { Requester }
