/* eslint class-methods-use-this: 1 */
const {
  messages,
  RequesterBase,
  hypercore: { FarmerConnection, MSG },
  util: { nonceString }
} = require('ara-reward-protocol')
const { token, rewards } = require('ara-contracts')
const { Countdown, isUpdateAvailable } = require('./util')
const { toHexString } = require('ara-util/transform')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const crypto = require('ara-crypto')
const debug = require('debug')('ard:requester')

class Requester extends RequesterBase {
  /**
   * Requester replicates an AFS for a sow
   * @param {String} user.did did of the requester
   * @param {String} user.password password of the requester's did
   * @param {AFS} afs Instance of AFS
   */
  constructor(jobNonce, matcher, user, afs, swarm, queue) {
    const signature = new messages.Signature()
    signature.setDid(user.did)

    const sow = new messages.SOW()
    sow.setNonce(jobNonce)
    sow.setTopic(afs.discoveryKey.toString('hex'))
    sow.setWorkUnit('AFS')
    sow.setCurrencyUnit('Ara^-18')
    sow.setSignature(signature)

    super(sow, matcher)

    this.hiredFarmers = new Map()
    this.deliveryMap = new Map()
    this.stateMap = new Map()
    this.user = user
    this.swarm = swarm
    this.afs = afs
    this.topic = this.afs.discoveryKey
    this.queue = queue
  }

  _info(message) {
    this.emit('info', message)
  }

  start() {
    const self = this
    const transaction = () => self._prepareJob()
    this.queue.push(transaction).then(() => {
      self._info(`Requesting content for: ${self.afs.did}`)
      if (self.swarm) {
        self._download()
        self.swarm.join(self.topic, { lookup: true, announce: false })
      }
    }).catch((err) => {
      debug(`failed to start broadcast for ${self.afs.did}`, err)
    })
  }

  onConnection(connection, details) {
    const self = this
    const peer = details.peer || {}
    const partition = this.afs.partitions.home

    // Note: hypercore requires extensions array to be sorted
    const stream = partition.metadata.replicate({
      live: true,
      download: true,
      upload: false,
      expectedFeeds: 2,
      extensions: [ MSG.AGREEMENT, MSG.QUOTE, MSG.RECEIPT, MSG.REWARD, MSG.SOW ]
    })

    // Wait for metadata to be ready
    partition.metadata.ready((err) => {
      if (err) {
        connection.destroy()
        debug('failed to ready metadata:', err)
        return
      }

      const feed = stream.feed(partition.metadata.key)
      const farmerConnection = new FarmerConnection(peer, stream, feed, { timeout: constants.DEFAULT_TIMEOUT })
      farmerConnection.once('close', () => {
        debug(`Stopping replication for ${self.afs.did} with peer ${farmerConnection.peerId}`)
      })

      stream.once('handshake', () => {
        process.nextTick(() => self.addFarmer(farmerConnection))
      })

      connection.pipe(stream).pipe(connection)
    })
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
  }

  _download() {
    const self = this
    const partition = self.afs.partitions.home
    let rewardComplete = false

    if (partition.content) {
      waitForLatest(partition.content)
    } else {
      self.afs.once('content', () => {
        waitForLatest(partition.content)
      })
    }

    // Handle when the content needs updated
    function waitForLatest(feed) {
      // Record download data for content
      feed.on('download', (_, data, from) => {
        self._dataReceived(from.stream.stream.peerId, data.length)
      })

      // Handle when the content finishes downloading
      const onSyncQueue = new AutoQueue()
      feed.on('sync', onSync)

      function onSync() {
        onSyncQueue.push(checkComplete)
      }

      async function checkComplete() {
        if (rewardComplete || await isUpdateAvailable(self.afs)) {
          return
        }
        rewardComplete = true
        self.stop()
        feed.removeListener('sync', onSync)

        // Close the peer streams so they know to stop sending
        for (const peer of feed.peers) {
          peer.end()
        }

        // TODO: store rewards to send later
        debug('Files:', await self.afs.readdir('.'))
        self.emit('download-complete')
        self._sendRewards()
      }
    }
  }

  // Retrieve or Submit the job to the blockchain
  async _prepareJob() {
    const self = this
    const budget = Number(token.constrainTokenValue(self.matcher.maxCost.toString()))

    debug(`Budgetting ${budget} Ara for AFS ${self.afs.did}`)
    const jobId = toHexString(nonceString(self.sow), { ethify: true })
    let currentBudget = 0
    try {
      currentBudget = await rewards.getBudget({ contentDid: self.afs.did, jobId })
    } catch (err) {
      debug('prepareJob:', err)
      currentBudget = 0
    }
    debug(`Current budget for job ${jobId} is: ${currentBudget}`)
    const diff = budget - currentBudget

    if (diff > 0) {
      debug(`Submitting additional budget: ${diff} Ara.`)
      await rewards.submit({
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
    // Store hired farmer
    this.hiredFarmers.set(connection.peerId, { connection, agreement })

    // Start work
    const partition = this.afs.partitions.home
    partition._ensureContent((err) => {
      if (err) {
        connection.onError(err)
        return
      }
      if (connection.stream.destroyed) return
      debug(`Replicating content with ${agreement.getQuote().getSignature().getDid()} from ${connection.peerId}`)

      partition.content.replicate({
        live: false,
        download: true,
        upload: false,
        stream: connection.stream
      })
    })
  }

  async onReceipt(receipt, connection) {
    // TODO: store receipts
    this.emit('receipt', receipt, connection)
  }

  _dataReceived(peerId, units) {
    if (this.deliveryMap.has(peerId)) {
      const total = this.deliveryMap.get(peerId) + units
      this.deliveryMap.set(peerId, total)
    } else {
      this.deliveryMap.set(peerId, units)
    }
  }

  async _sendRewards() {
    const self = this
    const farmers = []
    const rewardAmounts = []
    const rewardMap = new Map()
    const jobId = toHexString(nonceString(this.sow), { ethify: true })

    // Expects receipt or closure from all rewarded farmers
    const receiptCountdown = new Countdown(this.hiredFarmers.size, () => {
      self.emit('request-complete')
    })

    // Format rewards for contract
    let total = 0
    this.deliveryMap.forEach((value) => { total += value })
    debug('delivery map:', this.deliveryMap)
    debug('content size:', this.afs.partitions.home.content.byteLength, 'downloaded:', total)

    // Populate the reward map
    this.hiredFarmers.forEach((value, key) => {
      const { connection, agreement } = value
      const userId = agreement.getQuote().getSignature().getDid()

      connection.once('close', () => {
        receiptCountdown.decrement()
      })

      connection.once('receipt', () => {
        connection.close()
      })

      if (0 === total || !self.deliveryMap.has(key)) {
        debug(`Farmer ${userId} will not be rewarded.`)
        connection.close()
        return
      }

      const units = self.deliveryMap.get(key) / total
      const reward = self.generateReward(agreement, units)
      const amount = Number(token.constrainTokenValue(reward.getAmount().toString()))

      if (amount > 0) {
        debug(`Farmer ${userId} will be rewarded ${amount} Ara.`)
        farmers.push(userId)
        rewardAmounts.push(amount)
        rewardMap.set(key, reward)
      } else {
        debug(`Farmer ${userId} will not be rewarded.`)
        connection.close()
      }
    })

    // TODO: allow returning of full reward if no download happened
    if (0 === rewardMap.size) {
      debug(`No applicable rewards for job ${jobId}.`)
      self.emit('request-complete')
      return
    }

    const transaction = async () => {
      debug(`Allocating rewards for job ${jobId}.`)
      await rewards.allocate({
        requesterDid: self.user.did,
        password: self.user.password,
        contentDid: self.afs.did,
        job: {
          jobId,
          farmers,
          rewards: rewardAmounts,
          returnBudget: true
        }
      })
    }

    try {
      await this.queue.push(transaction)
      this.emit('job-complete', jobId)

      receiptCountdown.start()
      rewardMap.forEach((value, key) => {
        const { connection } = self.hiredFarmers.get(key)
        connection.sendReward(value)
      })
    } catch (err) {
      // TODO Handle failed job
      debug(`Failed to allocate rewards for job ${jobId}`)
    }
  }

  generateReward(agreement, units) {
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
