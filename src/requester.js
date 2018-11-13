/* eslint class-methods-use-this: 1 */
const {
  messages,
  RequesterBase,
  duplex: {
    FarmerConnection
  },
  util: {
    idify,
    nonceString
  }
} = require('ara-farming-protocol')

const {
  token: {
    constrainTokenValue
  },
  rewards: {
    submit,
    allocate,
    getBudget
  }
} = require('ara-contracts')
const { Countdown } = require('./util')
const { toHexString } = require('ara-util/transform')
const createHyperswarm = require('./hyperswarm')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:requester')

class Requester extends RequesterBase {
  /**
   * Requester replicates an AFS for a sow
   * @param {String} user.did did of the requester
   * @param {String} user.password password of the requester's did
   * @param {AFS} afs Instance of AFS
   */
  constructor(jobNonce, matcher, user, afs) {
    const signature = new messages.Signature()
    signature.setDid(user.did)

    const sow = new messages.SOW()
    sow.setNonce(jobNonce)
    sow.setTopic(afs.did)
    sow.setWorkUnit('AFS')
    sow.setCurrencyUnit('Ara^-18')
    sow.setSignature(signature)

    super(sow, matcher)

    this.hiredFarmers = new Map()
    this.deliveryMap = new Map()
    this.stateMap = new Map()
    this.user = user
    this.swarm = null
    this.afs = afs
    this._attachListeners()
  }

  start() {
    const self = this

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm()
    this.swarm.on('connection', handleConnection)

    this.swarm.join(this.afs.discoveryKey, { lookup: true, announce: false })
    debug('Requesting:', this.afs.did)

    function handleConnection(connection, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))
      const farmerConnection = new FarmerConnection(peer, connection, { timeout: 6000 })
      process.nextTick(() => self.addFarmer(farmerConnection))
    }
  }

  stop() {
    if (this.swarm) {
      this.swarm.leave(this.afs.discoveryKey)
      this.swarm.discovery.destroy()
      this.swarm = null
    }
  }

  _attachListeners() {
    const self = this

    const partition = self.afs.partitions.home
    if (partition.content) {
      attachDownloadListener(partition.content)
    } else {
      self.afs.once('content', () => {
        attachDownloadListener(partition.content)
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
        feed.close(() => {
          /**
           * Unpipe the streams attached to the farmer
           * sockets and resume AFP communication
           * */
          self.hiredFarmers.forEach((value) => {
            const { connection, stream } = value
            connection.stream.unpipe()
            stream.destroy()
            // TODO: put this somewhere internal to connection
            connection.stream.on('data', connection.onData.bind(connection))
            connection.stream.resume()
          })

          self.stop()
          // TODO: store rewards to send later
          self.sendRewards()
        })
      })
    }
  }

  // Retrieve or Submit the job to the blockchain
  async prepareJob() {
    const self = this
    const budget = Number(constrainTokenValue(self.matcher.maxCost.toString()))

    debug(`Budgetting ${budget} Ara for AFS ${self.afs.did}`)
    const jobId = toHexString(nonceString(self.sow), { ethify: true })
    let currentBudget = 0
    try {
      currentBudget = await getBudget({ contentDid: self.afs.did, jobId })
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
          jobId,
          budget: diff
        }
      })
      debug('Job submitted successfully')
    }
  }

  /**
   * Returns whether a quote is valid
   * @param {messages.Quote} quote
   * @returns {boolean}
   */
  async validateQuote(quote) {
    const data = Buffer.from(this.sow.serializeBinary())
    return this.user.verify(quote, data)
  }

  /**
   * Returns an agreement given a quote.
   * @param {messages.Quote} quote
   * @returns {messages.Agreement}
   */
  async generateAgreement(quote) {
    const quoteData = Buffer.from(quote.serializeBinary())
    const signature = this.user.sign(quoteData)
    const agreement = new messages.Agreement()
    agreement.setNonce(crypto.randomBytes(32))
    agreement.setQuote(quote)
    agreement.setSignature(signature)

    const nonce = nonceString(agreement)
    this.stateMap.set(nonce, Buffer.from(agreement.serializeBinary()))
    return agreement
  }

  /**
   * Returns whether an agreement is valid
   * @param {messages.Agreement} agreement
   * @returns {boolean}
   */
  async validateAgreement(agreement) {
    const nonce = nonceString(agreement)
    const data = this.stateMap.get(nonce)
    return this.user.verify(agreement, data)
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

    stream.on('error', (error) => {
      debug(error)
      // TODO: what to do with the connection on replication errors?
    })

    // Store hired farmer
    this.hiredFarmers.set(peerId, { connection, agreement, stream })

    // Start work
    debug(`Piping stream with ${agreement.getQuote().getSignature().getDid()} from ${peerId}`)
    connection.stream.pipe(stream).pipe(connection.stream, { end: false })
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
    const jobId = toHexString(nonceString(self.sow), { ethify: true })

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
      const userId = reward.getAgreement().getQuote().getSignature().getDid()
      const amount = Number(constrainTokenValue(reward.getAmount().toString()))

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
          jobId,
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
    const agreementData = Buffer.from(agreement.serializeBinary())
    const signature = this.user.sign(agreementData)

    const reward = new messages.Reward()
    reward.setNonce(crypto.randomBytes(32))
    reward.setAgreement(agreement)
    reward.setAmount(amount)
    reward.setSignature(signature)

    const nonce = nonceString(reward)
    this.stateMap.set(nonce, Buffer.from(reward.serializeBinary()))
    return reward
  }
}

module.exports = { Requester }
