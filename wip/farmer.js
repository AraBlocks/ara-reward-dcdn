/* eslint class-methods-use-this: 1 */
const { messages, FarmerBase, duplex, util } = require('ara-farming-protocol')
const { createSwarm } = require('ara-network/discovery')
const { info, warn } = require('ara-console')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:farmer')
const pify = require('pify')
const fp = require('find-free-port')
const ip = require('ip')
const duplexify = require('duplexify')
const { RequesterConnection } = duplex
const { idify, nonceString, weiToEther, bytesToGBs } = util

class Farmer extends FarmerBase {
  /**
   * Example Farmer replicates an AFS for a min price
   * @param {*} farmerId
   * @param {*} farmerSig
   * @param {int} price Desired price in wei/byte
   * @param {ContractABI} wallet Farmer's Wallet Contract ABI
   * @param {AFS} afs Instance of AFS
   */
  constructor(id, signature, price, wallet) {
    super()
    this.price = price
    this.farmerID = id
    this.farmerSig = signature
    this.deliveryMap = new Map()
    this.wallet = wallet
  }

  async broadcastService(did) {
    info('Broadcasting: ', did)

    const swarm = createSwarm()
    swarm.on('connection', handleConnection)
    swarm.join(did, { announce: false })
    const self = this

    function handleConnection(connection, peer) {
      info(`SWARM: New peer: ${idify(peer.host, peer.port)}`)
      const requesterConnection = new RequesterConnection(peer, connection, { timeout: 6000 })
      self.addRequester(requesterConnection)
    }
  }

  /**
   * Returns a quote given an SOW.
   * @param {messages.SOW} sow
   * @returns {messages.Quote}
   */
  async generateQuote(sow) {
    const quote = new messages.Quote()
    quote.setNonce(crypto.randomBytes(32))
    quote.setFarmer(this.farmerID)
    quote.setPerUnitCost(this.price)
    quote.setSow(sow)
    return quote
  }

  /**
   * Returns whether a agreement is valid
   * @param {messages.Agreement} agreement
   * @returns {boolean}
   */
  async validateAgreement(agreement) {
    const quote = agreement.getQuote()
    return quote.getPerUnitCost() == this.price
  }

  /**
   * Sign and return a agreement
   * @param {messages.Agreement} agreement
   * @returns {messages.Agreement}
   */
  async signAgreement(agreement) {
    agreement.setFarmerSignature(this.farmerSig)

    // Get free port and pass it as the agreement data
    const port = await pify(fp)(Math.floor(30000 * Math.random()), ip.address())
    const data = Buffer.alloc(4)
    data.writeInt32LE(port, 0)
    agreement.setData(data)

    // Start work on port
    // this.startWork(agreement, port)
    return agreement
  }

  async validateSow(sow) {
    if (sow) return true
    return false
  }

  dataTransmitted(sowId, units) {
    if (this.deliveryMap.has(sowId)) {
      const total = this.deliveryMap.get(sowId) + units
      this.deliveryMap.set(sowId, total)
    } else {
      this.deliveryMap.set(sowId, units)
    }
  }

  async withdrawReward(reward) {
    const sowId = nonceString(reward.getAgreement().getQuote().getSow())
    info(`Uploaded ${bytesToGBs(this.deliveryMap.get(sowId))} Gbs for job ${sowId}`)

    const farmerDid = this.farmerId.getDid()
    this.wallet
      .claimReward(sowId, farmerDid)
      .then(() => {
        info(`Reward amount ${weiToEther(reward.getAmount())} withdrawn for SOW ${sowId}`)
      })
      .catch((err) => {
        warn(`Failed to withdraw reward for SOW ${sowId}`)
        debug(err)
      })
  }

  /**
   * This should returns whether a reward is valid.
   * @param {messages.Reward} reward
   * @returns {boolean}
   */
  async validateReward(reward) {
    if (reward) return true
    return false
  }

  /**
   * This should return a receipt given a reward.
   * @param {messages.Reward} reward
   * @returns {messages.Receipt}
   */
  async generateReceipt(reward) {
    this.withdrawReward(reward)
    const receipt = new messages.Receipt()
    receipt.setNonce(crypto.randomBytes(32))
    receipt.setReward(reward)
    receipt.setFarmerSignature(this.farmerSig)
    return receipt
  }

  async onAgreement(agreement, connection) {
    await super.onAgreement(agreement, connection)
    const sow = agreement.getQuote().getSow()
    const sowId = nonceString(sow)
    this.emit("match", sowId)
  }

  async trackAFS(afs, sowId) {
    const { content } = afs.partitions.resolve(afs.HOME)
    content.on('upload', (index, data) => {
      this.dataTransmitted(sowId, data.length)
    })
  }

  handleDCDNConnection(_, peer) {
    info(`Connected to peer ${peer.host}:${peer.port}`)
  }
}

module.exports = { Farmer }
