/* eslint class-methods-use-this: 1 */
const {
  messages,
  RequesterBase,
  hypercore: { FarmerConnection, MSG },
  util: { nonceString }
} = require('ara-reward-protocol')
const { rewards } = require('ara-contracts')
const { Countdown, isUpdateAvailable } = require('./util')
const { toHexString } = require('ara-util/transform')
const AutoQueue = require('./autoqueue')
const BigNumber = require('bignumber.js')
const constants = require('./constants')
const crypto = require('ara-crypto')
const debug = require('debug')('ara:reward:requester')
const aid = require('ara-identity')

/**
 * @class An Ara-reward-protocol RequesterBase extension for AFS replication
 */
class Requester extends RequesterBase {
  /**
   * Constructs a new requester instance
   * @param {Matcher} opts.matcher A matcher
   * @param {User} opts.user A User object of the farmer
   * @param {AFS} opts.afs Instance of AFS
   * @param {Object} opts.swarm Instance of AFS
   * @param {String} opts.jobId Nonce for the Sow
   * @param {AutoQueue} [opts.queue] A transaction queue
   * @param {bool} [opts.metaOnly] Whether to only replicate the metadata
   */
  constructor(opts) {
    const signature = new messages.Signature()
    signature.setDid(opts.user.did)

    const sow = new messages.SOW()
    sow.setNonce(opts.jobId)
    sow.setTopic(opts.afs.discoveryKey.toString('hex'))
    sow.setWorkUnit('AFS')
    sow.setCurrencyUnit('Ara')
    sow.setSignature(signature)

    super(sow, opts.matcher)

    this.user = opts.user
    this.swarm = opts.swarm
    this.afs = opts.afs
    this.queue = opts.queue || new AutoQueue()
    this.metaOnly = opts.metaOnly || false

    this.hiredFarmers = new Map()
    this.deliveryMap = new Map()
    this.stateMap = new Map()
    this.topic = this.afs.discoveryKey
    this.jobReady = false
  }

  _info(message) {
    this.emit('info', message)
  }

  async start() {
    const self = this
    const transaction = (this.metaOnly) ? () => {} : () => self._prepareJob()
    await this.queue.push(transaction).then(() => {
      if (self.swarm) {
        if (self.metaOnly) {
          self._info(`Requesting metadata for: ${self.afs.did}`)
          // TODO: when to stop requesting?
        } else {
          self._info(`Requesting content for: ${self.afs.did}`)
          self._waitForContent()
        }
      }
    }).catch((err) => {
      debug(`failed to start broadcast for ${self.afs.did}`, err)
    })
  }

  onConnection(connection, details) {
    const self = this
    const peer = details.peer || {}
    const homePartition = this.afs.partitions.home
    const etcPartition = this.afs.partitions.etc
    const currEtcVersion = etcPartition.version

    // Note: hypercore requires extensions array to be sorted
    // Home partition metadata replication
    const stream = homePartition.metadata.replicate({
      live: !(self.metaOnly),
      download: true,
      upload: false,
      expectedFeeds: (self.metaOnly) ? 3 : 4,
      extensions: (self.metaOnly) ? null : [ MSG.AGREEMENT, MSG.QUOTE, MSG.RECEIPT, MSG.REWARD, MSG.SOW ]
    })

    // Etc partition metadata replication
    etcPartition.metadata.replicate({
      download: true,
      upload: false,
      stream
    })

    // Etc partition content replication
    this._replicateContent(etcPartition, stream, (err) => {
      if (err) {
        debug('error on readying etc partition')
      }
    })

    // Note: once the etc metadata feed ends, trigger etc content download
    etcPartition.metadata.on('peer-remove', onEtcMetaSync)
    connection.once('close', () => {
      etcPartition.metadata.removeListener('peer-remove', onEtcMetaSync)
    })

    // Home partition content replication
    if (!this.metaOnly) {
      this._replicateContent(homePartition, stream, (err) => {
        if (err) {
          debug('error on readying home partition')
          connection.destroy()
          return
        }

        const feed = stream.feed(homePartition.metadata.key)
        const farmerConnection = new FarmerConnection(peer, stream, feed, { timeout: constants.DEFAULT_TIMEOUT })
        farmerConnection.once('close', () => {
          debug(`Stopping replication for ${self.afs.did} with peer ${farmerConnection.peerId}`)
        })

        // TODO: retry at least once on timeout
        // TODO: if replication starts without agreement, don't timeout
        if (stream.remoteId) {
          process.nextTick(() => self.addFarmer(farmerConnection))
        } else {
          stream.once('handshake', () => {
            process.nextTick(() => self.addFarmer(farmerConnection))
          })
        }
      })
    }

    connection.pipe(stream).pipe(connection)

    function onEtcMetaSync(removed) {
      if (removed.remoteId === stream.remoteId) {
        etcPartition.download('metadata.json', () => {
          if (etcPartition.version > currEtcVersion) {
            self._info(`Synced metadata version: ${etcPartition.version} for afs ${self.afs.did}`)
          }
          if (self.metaOnly) stream.finalize()
        })
      }
    }
  }

  _replicateContent(partition, stream, callback) {
    partition.metadata.ready((e) => {
      if (e) {
        callback(e)
        return
      }
      partition._ensureContent((err) => {
        if (err) {
          callback(err)
          return
        }
        if (stream.destroyed) return

        partition.content.replicate({
          live: false,
          download: true,
          upload: false,
          stream
        })

        callback()
      })
    })
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
  }

  _waitForContent() {
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
    const budget = Number.parseFloat(self.matcher.maxCost)

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
      this.jobReady = true
      debug('Job submitted successfully')
    } 
    else {
      this.jobReady = true
    }
  }

  /**
   * Returns whether a quote is valid
   * @param {messages.Quote} quote
   * @returns {boolean}
   */
  async validateQuote(quote) {
    try {
      // Validate user
      const data = Buffer.from(this.sow.serializeBinary())
      if (!this.user.verify(quote, data)) {
        debug('invalid quote: bad signature')
        return false
      }

      // Resolve user
      const farmer = quote.getSignature().getDid()
      const ddo = await aid.resolve(farmer)
      if (!ddo) {
        debug('invalid quote: failed to resolve peer')
        return false
      }
    } catch (err) {
      debug('invalid quote:', err)
      return false
    }
    return true
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
    try {
      // Verify signature
      const nonce = nonceString(agreement)
      const data = this.stateMap.get(nonce)
      if (!this.user.verify(agreement, data)) {
        debug('invalid agreement: unverified signature')
        return false
      }
    } catch (err) {
      debug('invalid agreement:', err)
      return false
    }

    return true
  }

  async onHireConfirmed(agreement, connection) {
    // Store hired farmer
    this.hiredFarmers.set(connection.peerId, { connection, agreement })
    debug(`Replicating content with ${agreement.getQuote().getSignature().getDid()} from ${connection.peerId}`)
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
      const amount = Number.parseFloat(reward.getAmount())

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
    const amount = BigNumber(quote.getPerUnitCost()).multipliedBy(units).toString()
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
