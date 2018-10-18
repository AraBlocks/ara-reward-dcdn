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

const { submit, allocate, getBudget } = require('ara-contracts/rewards')
const { Countdown } = require('./util')
const { ethify } = require('ara-util/web3')
const createHyperswarm = require('@hyperswarm/network')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')
const utp = require('utp-native')

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
    this.deliveryMap = new Map()
    this.user = user

    this.userID = new messages.AraId()
    this.userID.setDid(user.did)

    // TODO: actually sign data
    this.requesterSig = new messages.Signature()
    this.requesterSig.setAraId(this.userID)
    this.requesterSig.setData('avalidsignature')

    this.swarm = null
    this.afs = afs
    this._attachListeners()
  }

  start(){
    const self = this

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm({ socket: utp() })
    this.swarm.on('connection', handleConnection)
    this.swarm.join(Buffer.from(this.afs.did, 'hex'), { lookup: true, announce: false })
    debug('Requesting: ', this.afs.did)

    function handleConnection(socket, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))
      const farmerConnection = new FarmerConnection(peer, socket, { timeout: 6000 })
      process.nextTick(() => self.addFarmer(farmerConnection))
    }
  }

  stop(){
    if (this.swarm) {
      this.swarm.leave(Buffer.from(this.afs.did, 'hex'))
      this.swarm.discovery.destroy()
      this.swarm = null
    }
  }

  _attachListeners() {
    const self = this

    const { content } = self.afs.partitions.resolve(self.afs.HOME)

    if (content) {
      attachDownloadListener(content)
    } else {
      self.afs.once('content', () => {
        attachDownloadListener(self.afs.partitions.resolve(self.afs.HOME).content)
      })
    }

    // Handle when the content needs updated
    function attachDownloadListener(feed) {
      // Record download data
      feed.on('download', (index, data, from) => {
        self.dataReceived(from.stream.stream.peerId, data.length)
      })

      // Handle when the content finishes downloading
      feed.once('sync', async () => {
        debug('Files:', await self.afs.readdir('.'))
        self._closeReplicationStreams()
        self.stop()
        self.sendRewards()
      })
    }
  }

  // Retrieve or Submit the job to the blockchain
  async prepareJob() {
    const self = this
    // TODO: use Ara rather than ether conversion
    const budget = weiToEther(self.matcher.maxCost)

    debug(`Budgetting ${budget} Ara for AFS ${self.afs.did}`)
    const jobId = nonceString(self.sow)
    let currentBudget = 0
    try {
      currentBudget = await getBudget({ contentDid: self.afs.did, jobId: ethify(jobId) })
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
        contentDid: self.afs.did,
        job: {
          jobId: ethify(jobId),
          budget: diff
        }
      })
      debug('Job submitted successfully')
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
    // TODO: put this somewhere internal to connection
    connection.stream.removeAllListeners('data')

    const { peerId } = connection

    const stream = this.afs.replicate({
      upload: false,
      download: true
    })
    stream.peerId = peerId

    // Store hired farmer
    this.hiredFarmers.set(peerId, { connection, agreement, stream })

    // Start work
    debug(`Piping stream with ${agreement.getQuote().getFarmer().getDid()} from ${peerId}`)
    connection.stream.pipe(stream).pipe(connection.stream, { end: false })
  }

  _closeReplicationStreams()
  {
    this.hiredFarmers.forEach((value, key) => {
      const { connection, stream } = value
      connection.stream.unpipe()
      stream.destroy()
      // TODO: put this somewhere internal to connection
      connection.stream.on('data', connection.onData.bind(connection))
      connection.stream.resume()
    })
  }

  async onReceipt(receipt, connection) {
    // Expects receipt from all rewarded farmers
    if (receipt && connection) {
      if (this.receiptCountdown) this.receiptCountdown.decrement()
      connection.stream.destroy()
    }
  }

  dataReceived(peerId, units) {
    if (this.deliveryMap.has(peerId)) {
      const total = this.deliveryMap.get(peerId) + units
      this.deliveryMap.set(peerId, total)
    } else {
      this.deliveryMap.set(peerId, units)
    }
  }

  async sendRewards() {
    const self = this
    const farmers = []
    const rewards = []
    const rewardMap = new Map()
    const jobId = nonceString(self.sow)

    // Format rewards for contract
    this.receiptCountdown = new Countdown(this.deliveryMap.size, () => {
      // TODO: handle if not enough receipts come back
      self.emit('jobcomplete', jobId)
    })
    let total = 0
    this.deliveryMap.forEach((value) => { total += value })

    if (0 === total) {
      debug('No bytes received. Not sending rewards.')
      return
    }

    this.deliveryMap.forEach((value, key) => {
      const peerId = key
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
        contentDid: self.afs.did,
        job: {
          jobId: ethify(jobId),
          farmers,
          rewards
        }
      })
    } catch (err) {
      debug(`Failed to allocate rewards for job ${jobId}`)
      // TODO Handle failed job
    }

    rewardMap.forEach((value, key) => {
      const { connection } = self.hiredFarmers.get(key)
      connection.sendReward(value)
    })
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
