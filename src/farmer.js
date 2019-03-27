/* eslint class-methods-use-this: 1 */
const {
  messages,
  FarmerBase,
  hypercore: { RequesterConnection, MSG },
  util: { nonceString, bytesToGBs }
} = require('ara-reward-protocol')
const { isJobOwner } = require('./util')
const { library, rewards } = require('ara-contracts')
const { toHexString } = require('ara-util/transform')
const constants = require('./constants')
const crypto = require('ara-crypto')
const debug = require('debug')('ara:reward:farmer')

/**
 * @class An Ara-reward-protocol FarmerBase extension for AFS replication
 */
class Farmer extends FarmerBase {
  /**
   * Constructs a new farmer instance
   * @param {User} opts.user user object of the farmer
   * @param {AFS} opts.afs Instance of AFS
   * @param {Object} opts.swarm Instance of AFS
   * @param {string} opts.price Desired price in Ara/upload
   * @param {bool} [opts.metaOnly] Whether to only replicate the metadata
   */
  constructor(opts) {
    super()
    this.user = opts.user
    this.afs = opts.afs
    this.price = opts.price
    this.swarm = opts.swarm
    this.metaOnly = opts.metaOnly || false

    this.priceNum = Number.parseFloat(this.price)
    if (Number.isNaN(this.priceNum)) throw new Error('Price is NaN')

    this.deliveryMap = new Map()
    this.stateMap = new Map()
    this.topic = this.afs.discoveryKey
  }

  _info(message) {
    this.emit('info', message)
  }

  async start() {
    this._info(`Seeding ${this.afs.did} content version: ${this.afs.version} etc version: ${this.afs.partitions.etc.version}`)
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
  }

  // TODO: should be able to move most of this out into dcdn.js
  async onConnection(connection, details) {
    const self = this
    const peer = details.peer || {}
    const homePartition = this.afs.partitions.home
    const etcPartition = this.afs.partitions.etc

    // Note: hypercore requires extensions array to be sorted
    // Home partition metadata replication
    const stream = homePartition.metadata.replicate({
      live: !(self.metaOnly),
      download: false,
      upload: true,
      expectedFeeds: (self.metaOnly) ? 3 : 4,
      extensions: (self.metaOnly) ? null : [ MSG.AGREEMENT, MSG.QUOTE, MSG.RECEIPT, MSG.REWARD, MSG.SOW ]
    })

    // Etc partition metadata replication
    etcPartition.metadata.replicate({
      download: false,
      upload: true,
      stream
    })

    // Etc partition content replication
    self._replicateContent(etcPartition, stream, (err) => {
      if (err) {
        debug('error on readying etc partition')
      }
    })

    // Home partition content replication
    if (!this.metaOnly) {
      homePartition.metadata.ready((err) => {
        if (err) {
          debug('error on readying home partition')
          connection.destroy()
          return
        }

        const feed = stream.feed(homePartition.metadata.key)
        const requesterConnection = new RequesterConnection(peer, stream, feed, { timeout: constants.DEFAULT_TIMEOUT })
        requesterConnection.once('close', () => {
          debug(`Stopping replication for ${self.afs.did} with peer ${requesterConnection.peerId}`)
        })

        if (stream.remoteId) {
          self.addRequester(requesterConnection)
        } else {
          stream.once('handshake', () => {
            self.addRequester(requesterConnection)
          })
        }
      })
    }

    connection.pipe(stream).pipe(connection)
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
          download: false,
          upload: true,
          stream
        })

        callback()
      })
    })
  }

  /**
   * Returns whether a SOW is valid.
   * @param {messages.SOW} sow
   * @returns {boolean}
   */
  async validateSow(sow) {
    try {
      if (this.topic.toString('hex') != sow.getTopic()) {
        debug('invalid sow: incorrect topic')
        return false
      }
    } catch (err) {
      debug('invalid sow:', err)
      return false
    }
    return true
  }

  /**
   * Returns a quote given an SOW.
   * @param {messages.SOW} sow
   * @returns {messages.Quote}
   */
  async generateQuote(sow) {
    const sowData = Buffer.from(sow.serializeBinary())
    const signature = this.user.sign(sowData)
    const quote = new messages.Quote()
    quote.setNonce(crypto.randomBytes(32))
    quote.setPerUnitCost(this.price)
    quote.setSow(sow)
    quote.setSignature(signature)

    const nonce = nonceString(quote)
    this.stateMap.set(nonce, Buffer.from(quote.serializeBinary()))
    return quote
  }

  /**
   * Returns whether an agreement is valid
   * @param {messages.Agreement} agreement
   * @returns {boolean}
   */
  async validateAgreement(agreement) {
    try {
      // Verify the requester's identity
      const requester = agreement.getSignature().getDid()
      const nonce = nonceString(agreement.getQuote())
      const data = this.stateMap.get(nonce)
      if (!this.user.verify(agreement, data)) {
        debug('invalid agreement: bad signature')
        return false
      }

      // Verify the requester has purchased the content (TODO: or has deposited, once k-swarm)
      if (!(await library.hasPurchased({
        contentDid: this.afs.did,
        purchaserDid: requester
      }))) {
        debug('invalid agreement: requester hasn\'t purchased')
        return false
      }

      if (this.priceNum) {
        // Verify there is adequate budget in the job
        const jobId = toHexString(nonceString(agreement.getQuote().getSow()), { ethify: true })
        const budget = Number.parseFloat(await rewards.getBudget({ contentDid: this.afs.did, jobId }))
        if (budget < this.priceNum) {
          debug('invalid agreement: job under budget')
          return false
        }

        // Verify the requester is the owner of the job
        if (!(await isJobOwner({
          contentDid: this.afs.did,
          jobId,
          owner: requester
        }))) {
          debug('invalid agreement: requester not job owner')
          return false
        }
      }
    } catch (err) {
      debug('invalid agreement:', err)
      return false
    }

    return true
  }

  /**
   * Sign and return an agreement to the requester
   * @param {messages.Agreement} agreement
   * @returns {messages.Agreement}
   */
  async signAgreement(agreement) {
    const agreementData = Buffer.from(agreement.serializeBinary())
    const signature = this.user.sign(agreementData)
    agreement.setSignature(signature)

    const nonce = nonceString(agreement)
    this.stateMap.set(nonce, Buffer.from(agreement.serializeBinary()))
    return agreement
  }

  _dataTransmitted(sowId, units) {
    if (this.deliveryMap.has(sowId)) {
      const total = this.deliveryMap.get(sowId) + units
      this.deliveryMap.set(sowId, total)
    } else {
      this.deliveryMap.set(sowId, units)
    }
  }

  /**
   * Returns whether a reward is valid.
   * @param {messages.Reward} reward
   * @returns {boolean}
   */
  async validateReward(reward) {
    try {
      // TODO: need to compare expected and received reward
      const nonce = nonceString(reward.getAgreement())
      const data = this.stateMap.get(nonce)
      if (!this.user.verify(reward, data)) {
        debug('invalid reward: bad signature')
        return false
      }
    } catch (err) {
      debug('invalid reward:', err)
      return false
    }
    return true
  }

  /**
   * Returns a receipt given a reward.
   * @param {messages.Reward} reward
   * @returns {messages.Receipt}
   */
  async generateReceipt(reward) {
    const sowId = nonceString(reward.getAgreement().getQuote().getSow())
    debug(`Uploaded ${bytesToGBs(this.deliveryMap.get(sowId))} Gbs for job ${sowId}`)

    const rewardData = Buffer.from(reward.serializeBinary())
    const signature = this.user.sign(rewardData)
    const receipt = new messages.Receipt()
    receipt.setNonce(crypto.randomBytes(32))
    receipt.setReward(reward)
    receipt.setSignature(signature)

    const nonce = nonceString(receipt)
    this.stateMap.set(nonce, Buffer.from(receipt.serializeBinary()))
    return receipt
  }

  async onHireConfirmed(agreement, connection) {
    const self = this
    const sow = agreement.getQuote().getSow()
    const requester = sow.getSignature().getDid()
    debug(`Starting replication for ${this.afs.did} with requester ${requester}`)

    const sowId = nonceString(sow)
    const partition = this.afs.partitions.home

    partition.content.on('upload', (_, data) => {
      self._dataTransmitted(sowId, data.length)
    })

    self._replicateContent(partition, connection.stream, (err) => {
      if (err) {
        connection.onError(err)
      }
    })
  }
}

module.exports = { Farmer }
