/* eslint class-methods-use-this: 1 */
const {
  messages,
  RequesterBase,
  duplex: {
    FarmerConnection
  },
  util: {
    idify,
    nonceString,
    weiToEther
  }
} = require('ara-farming-protocol')
const { createSwarm, createHyperswarm } = require('ara-network/discovery')
//const createHyperswarm = require('@hyperswarm/network')
const { submit, allocate, getBudget } = require('ara-contracts/rewards')
const { Countdown } = require('./util')
const { ethify } = require('ara-util/web3')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')

class Requester extends RequesterBase {
  /**
   * Requester replicates an AFS for a sow
   * @param {String} user.did did of the requester
   * @param {String} user.password password of the requester's did
   * @param {AFS} afs Instance of AFS
   */
  constructor(sow, matcher, user, afs) {
    super(sow, matcher)
    this.hiredFarmers = new Map()
    this.swarmIdMap = new Map()
    this.deliveryMap = new Map()
    this.user = user

    this.userID = new messages.AraId()
    this.userID.setDid(user.did)

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
    // Calculate and submit job budget
    try {
      const amount = weiToEther(self.matcher.maxCost)
      await self.prepareJob(self.afs.did, amount)
    } catch (err) {
      debug(`failed to start broadcast for ${self.afs.did}`, err)
      return
    }

    self.setupContentSwarm()
    self.peerSwarm = createHyperswarm()
    self.peerSwarm.on('connection', handleConnection)
    self.peerSwarm.join(Buffer.from(self.afs.did, 'hex'), { lookup: true, announce: false })

    function handleConnection(socket, details) {
      const peer = details.peer || {}
      debug(`Peer Swarm: Peer connected: ${idify(peer.host, peer.port)}`)
      const farmerConnection = new FarmerConnection(peer, socket, { timeout: 6000 })
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
  async prepareJob(contentDid, budget) {
    debug(`Budgetting ${budget} Ara for AFS ${contentDid}`)
    const self = this
    const jobId = nonceString(self.sow)
    let currentBudget = 0
    try {
      currentBudget = await getBudget({ contentDid, jobId: ethify(jobId) })
    } catch (err) {
      debug('prepareJob:', err)
      currentBudget = 0
    }
    debug(`Current budget for job ${jobId} is: ${currentBudget}`)
    const diff = budget - currentBudget

    if (diff > 0) {
      debug(`Submitting additional budget: ${diff} Ara.`)
      await submit({
        requesterDid: self.user.did,
        password: self.user.password,
        contentDid,
        job: {
          jobId: ethify(jobId),
          budget: diff
        }
      })
      debug('Job submitted successfully')
    }
    self.emit('jobready', jobId, contentDid)
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

  async sendRewards(contentDid) {
    const self = this
    const farmers = []
    const rewards = []
    const rewardMap = new Map()
    const jobId = nonceString(self.sow)

    // Format rewards for contract
    this.receiptCountdown = new Countdown(this.deliveryMap.size, this.stopBroadcast.bind(this))
    let total = 0
    this.deliveryMap.forEach((value) => { total += value })

    if (0 === total) {
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

    try {
      debug(`Allocating rewards for job ${jobId}.`)
      await allocate({
        requesterDid: self.user.did,
        password: self.user.password,
        contentDid,
        job: {
          jobId: ethify(jobId),
          farmers,
          rewards
        }
      })
    } catch (err) {
      debug(`Failed to allocate rewards for job ${jobId}`)
      // TODO Handle failed job
      self.stopBroadcast(err)
    }

    rewardMap.forEach((value, key) => {
      const { connection } = self.hiredFarmers.get(key)
      connection.sendReward(value)
    })
    self.emit('jobcomplete', jobId)
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
