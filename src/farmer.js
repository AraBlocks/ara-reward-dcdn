/* eslint class-methods-use-this: 1 */
const {
  messages,
  FarmerBase,
  hypercore: { RequesterConnection, MSG },
  util: { nonceString, bytesToGBs }
} = require('ara-reward-protocol')
const { isJobOwner } = require('./util')
const { library, rewards, token } = require('ara-contracts')
const { toHexString } = require('ara-util/transform')
const constants = require('./constants')
const crypto = require('ara-crypto')
const debug = require('debug')('ard:farmer')

class Farmer extends FarmerBase {
  /**
   * Farmer replicates an AFS for a min price
   * @param {String} user.did did of the farmer
   * @param {String} user.password password of the farmer's did
   * @param {int} price Desired price in Ara^-18/upload
   * @param {AFS} afs Instance of AFS
   */
  constructor(user, price, afs, swarm) {
    super()
    this.price = price
    this.deliveryMap = new Map()
    this.stateMap = new Map()
    this.afs = afs
    this.topic = afs.discoveryKey
    this.swarm = swarm
    this.user = user
  }

  start() {
    this.swarm.join(this.topic, { lookup: false, announce: true })
    debug('Seeding: ', this.afs.did, 'version:', this.afs.version)
  }

  async onConnection(connection, details) {
    const stream = this._replicate(details)
    connection.pipe(stream).pipe(connection)
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
  }

  _replicate(details) {
    const self = this
    const peer = details.peer || {}
    const partition = this.afs.partitions.home

    // Note: hypercore requires extensions array to be sorted
    const stream = partition.metadata.replicate({
      live: true,
      expectedFeeds: 2,
      extensions: [ MSG.AGREEMENT, MSG.QUOTE, MSG.RECEIPT, MSG.REWARD, MSG.SOW ]
    })

    const feed = stream.feed(partition.metadata.discoveryKey)
    const requesterConnection = new RequesterConnection(peer, stream, feed, { timeout: constants.DEFAULT_TIMEOUT })
    requesterConnection.once('close', () => {
      debug(`Stopping replication for ${self.afs.did} with peer ${requesterConnection.peerId}`)
    })

    stream.once('handshake', () => {
      self.addRequester(requesterConnection)
    })

    return stream
  }

  /**
   * Returns whether a SOW is valid.
   * @param {messages.SOW} sow
   * @returns {boolean}
   */
  async validateSow(sow) {
    try {
      const match = this.topic.toString('hex') === sow.getTopic()
      return match
    } catch (err) {
      debug(err)
      return false
    }
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

      if (this.price) {
        // Verify there is adequate budget in the job
        const jobId = toHexString(nonceString(agreement.getQuote().getSow()), { ethify: true })
        const budget = Number(await rewards.getBudget({ contentDid: this.afs.did, jobId }))
        if (budget < Number(token.constrainTokenValue(this.price.toString()))) {
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
      debug(err)
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

  dataTransmitted(sowId, units) {
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
      return this.user.verify(reward, data)
    } catch (err) {
      debug(err)
      return false
    }
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
    const { content } = this.afs.partitions.resolve(this.afs.HOME)
    content.on('upload', (_, data) => {
      self.dataTransmitted(sowId, data.length)
    })

    const partition = this.afs.partitions.home
    partition._ensureContent((err) => {
      if (err) {
        connection.onError(err)
        return
      }
      if (connection.stream.destroyed) return
      partition.content.replicate({
        live: false,
        download: false,
        upload: true,
        stream: connection.stream
      })
    })
  }
}

module.exports = { Farmer }
