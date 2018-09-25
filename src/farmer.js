/* eslint class-methods-use-this: 1 */
const { messages, FarmerBase, duplex, util } = require('ara-farming-protocol')
const { createSwarm } = require('ara-network/discovery')
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
   * @param {int} price Desired price in wei/byte
   * @param {ContractABI} wallet Farmer's Wallet Contract ABI
   * @param {AFS} afs Instance of AFS
   */
  constructor(wallet, price, afs) {
    super()
    this.price = price
    this.deliveryMap = new Map()
    this.wallet = wallet
    this.afs = afs

    this.farmerID = new messages.AraId()
    this.farmerID.setDid(wallet.userID)

    // TODO: actually sign data
    this.farmerSig = new messages.Signature()
    this.farmerSig.setAraId(this.farmerID)
    this.farmerSig.setData('avalidsignature')
  }

  startBroadcast() {
    debug('Broadcasting: ', this.afs.did)

    this.peerSwarm = createSwarm()
    this.peerSwarm.on('connection', handleConnection)
    this.peerSwarm.join(this.afs.did, { announce: false })
    const self = this

    function handleConnection(connection, peer) {
      debug(`Peer Swarm: Peer Connected: ${idify(peer.host, peer.port)}`)
      const requesterConnection = new RequesterConnection(peer, connection, { timeout: 6000 })
      self.addRequester(requesterConnection)
    }
  }

  stopBroadcast(){
    if (this.peerSwarm) this.peerSwarm.destroy()
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
    //TODO: check that data is signed by requester
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
    this.startWork(agreement, port)
    return agreement
  }

  async validateSow(sow) {
    //TODO: Validate DID
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
    const sowId = nonceString(reward.getAgreement().getQuote().getSow())
    debug(`Uploaded ${bytesToGBs(this.deliveryMap.get(sowId))} Gbs for job ${sowId}`)
    const receipt = new messages.Receipt()
    receipt.setNonce(crypto.randomBytes(32))
    receipt.setReward(reward)
    receipt.setFarmerSignature(this.farmerSig)
    return receipt
  }

  async startWork(agreement, port) {
    const sow = agreement.getQuote().getSow()
    debug(`Listening for requester ${sow.getRequester().getDid()} on port ${port}`)
    const sowId = nonceString(sow)
    const { content } = this.afs.partitions.resolve(this.afs.HOME)

    const self = this
    content.on('upload', (index, data) => {
      self.dataTransmitted(sowId, data.length)
    })

    const opts = {
      stream
    }
    const swarm = createSwarm(opts)
    swarm.on('connection', handleConnection)
    swarm.listen(port)

    function stream() {
      const afsstream = self.afs.replicate({
        upload: true,
        download: false
      })
      afsstream.once('end', onend)

      function onend() {
        swarm.destroy()
      }

      return afsstream
    }

    function handleConnection(_, peer) {
      debug(`Content Swarm: Peer Connected: ${idify(peer.host, peer.port)}`)
    }
  }
}

module.exports = { Farmer }
