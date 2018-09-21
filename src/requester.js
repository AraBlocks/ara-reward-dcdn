/* eslint class-methods-use-this: 1 */
const { messages, RequesterBase, duplex, util } = require('ara-farming-protocol')
const { createSwarm } = require('ara-network/discovery')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')
const { maskHex } = require('./contract-abi')

const {
  idify, nonceString, bytesToGBs, weiToEther
} = util
const { FarmerConnection } = duplex

class Requester extends RequesterBase {
  constructor(sow, matcher, wallet, afs) {
    super(sow, matcher)
    this.hiredFarmers = new Map()
    this.swarmIdMap = new Map()
    this.deliveryMap = new Map()
    this.receipts = 0
    this.wallet = wallet
    this.autoQueue = []

    this.userID = new messages.AraId()
    this.userID.setDid(wallet.userID)

    // TODO: actually sign data
    this.requesterSig = new messages.Signature()
    this.requesterSig.setAraId(this.userID)
    this.requesterSig.setData('avalidsignature')

    this.afs = afs
  }

  async appendToAutoQueue(transaction) {
    const self = this
    const onComplete = (err) => {
      if (err) self.stopBroadcast(err)
      else {
        self.autoQueue.shift()
        if (self.autoQueue.length > 0) self.autoQueue[0]()
      }
    }

    this.autoQueue.push(() => {
      transaction(onComplete)
    })

    if (this.autoQueue.length == 1) this.autoQueue[0]()
  }

  startBroadcast() {
    debug('Requesting: ', this.afs.did)

    this.setupContentSwarm()

    this.peerSwarm = createSwarm()
    this.peerSwarm.on('connection', handleConnection)
    this.peerSwarm.join(this.afs.did)
    const self = this
    function handleConnection(connection, peer) {
      debug(`Peer Swarm: Peer connected: ${idify(peer.host, peer.port)}`)
      const farmerConnection = new FarmerConnection(peer, connection, { timeout: 6000 })
      process.nextTick(() => self.addFarmer(farmerConnection))
    }
  }

  async setupContentSwarm() {
    const self = this
    this.jobSubmitted = false
    this.contentSwarm = createSwarm({ stream })
    this.contentSwarm.on('connection', handleConnection)

    let oldByteLength = 0
    const { content } = self.afs.partitions.resolve(self.afs.HOME)

    if (content) {
      // TODO: calc current downloaded size in bytes
      oldByteLength = 0
      attachDownloadListener(content)
    } else {
      self.afs.once('content', () => {
        attachDownloadListener(self.afs.partitions.resolve(self.afs.HOME).content)
      })
    }

    // Handle when the content needs updated
    async function attachDownloadListener(feed) {
      // Calculate and job budget
      // NOTE: this is a hack to get content size and should be done prior to download
      // TODO: use Ara rather than ether conversion
      feed.once('download', () => {
        debug(`old size: ${oldByteLength}, new size: ${feed.byteLength}`)
        const sizeDelta = feed.byteLength - oldByteLength
        const amount = weiToEther(self.matcher.maxCost * sizeDelta) / bytesToGBs(1)
        debug(`Staking ${amount} Ara for a size delta of ${bytesToGBs(sizeDelta)} GBs`)
        self.submitJob(self.afs.did, amount)
      })

      // Record download data
      feed.on('download', (index, data, from) => {
        const peerIdHex = from.remoteId.toString('hex')
        self.dataReceived(peerIdHex, data.length)
      })

      // Handle when the content finishes downloading
      feed.once('sync', async () => {
        debug("Files:", await self.afs.readdir('.'))
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

  stopBroadcast(err){
    if (err) debug(`Completion Error: ${err}`)
    if (this.contentSwarm) this.contentSwarm.destroy()
    if (this.peerSwarm) this.peerSwarm.destroy()
    debug('Service Stopped')
    this.emit('complete', err)
  }

  // Submit the job to the blockchain
  async submitJob(contentDid, amount) {
    const self = this
    const jobId = maskHex(nonceString(self.sow))

    const transaction = (onComplete) => {
      debug(`Submitting job ${jobId} with budget ${amount} Ara.`)
      self.wallet
        .submitJob(contentDid, jobId, amount)
        .then(() => {
          debug('Job submitted successfully')
          onComplete()
        })
        .catch((err) => {
          onComplete(err)
        })
    }

    self.appendToAutoQueue(transaction)
  }

  async validateQuote(quote) {
    //TODO: Validate DID
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
    const self = this
    let farmers = []
    let rewards = []
    let rewardMap = new Map()
    const jobId = maskHex(nonceString(self.sow))

    // Format rewards for contract
    this.deliveryMap.forEach((value, key) => {
      const peerId = this.swarmIdMap.get(key)
      const units = value
      const reward = this.generateReward(peerId, units)
      const userId = reward.getAgreement().getQuote().getFarmer().getDid()
      const amount = weiToEther(reward.getAmount()) / bytesToGBs(1) // TODO: use Ara

      if (amount > 0) {
        farmers.push(userId)
        rewards.push(amount)
        rewardMap.set(peerId, reward)
        debug(`Farmer ${userId} will be rewarded ${amount} Ara.`)
      } 
      else {
        debug(`Farmer ${userId} will not be rewarded.`)
        this.incrementOnComplete()
      }
    })

    const transaction = (onComplete) => {
      debug(`Submitting reward for job ${jobId}.`)
      self.wallet
        .submitRewards(contentId, jobId, farmers, rewards)
        .then(() => {
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

    this.appendToAutoQueue(transaction)
  }

  incrementOnComplete() {
    this.receipts++
    if (this.receipts === this.deliveryMap.size) {
      this.stopBroadcast()
    }
  }

  generateReward(peerId, units) {
    const { agreement } = this.hiredFarmers.get(peerId)
    const quote = agreement.getQuote()
    const amount = quote.getPerUnitCost() * units
    const reward = new messages.Reward()
    reward.setNonce(crypto.randomBytes(32))
    reward.setAgreement(agreement)
    reward.setAmount(amount)
    return reward
  }
}

module.exports = { Requester }
