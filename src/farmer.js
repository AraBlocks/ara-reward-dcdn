/* eslint class-methods-use-this: 1 */
const {
  messages,
  FarmerBase,
  duplex: {
    RequesterConnection
  },
  util: {
    idify,
    nonceString,
    bytesToGBs
  }
} = require('ara-farming-protocol')
const createHyperswarm = require('@hyperswarm/network')
const crypto = require('ara-crypto')
const debug = require('debug')('afd:farmer')
const utp = require('utp-native')

class Farmer extends FarmerBase {
  /**
   * Farmer replicates an AFS for a min price
   * @param {String} user.did did of the farmer
   * @param {String} user.password password of the farmer's did
   * @param {int} price Desired price in Ara^-18/upload
   * @param {AFS} afs Instance of AFS
   */
  constructor(user, price, afs) {
    super()
    this.price = price
    this.deliveryMap = new Map()
    this.afs = afs
    this.swarm = null

    this.user = user
    this.farmerID = new messages.AraId()
    this.farmerID.setDid(user.did)

    // TODO: actually sign data
    this.farmerSig = new messages.Signature()
    this.farmerSig.setAraId(this.farmerID)
    this.farmerSig.setData('avalidsignature')
  }

  start() {
    const self = this

    const socket = utp()
    socket.on('error', (error) => {
      debug(error)
      // TODO: what to do with utp errors?
    })

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm({ socket, domain: 'ara.local' })
    this.swarm.on('connection', handleConnection)
    this.swarm.join(this.afs.discoveryKey, { lookup: false, announce: true })
    debug('Seeding: ', this.afs.did)

    function handleConnection(connection, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))
      const requesterConnection = new RequesterConnection(peer, connection, { timeout: 6000 })
      self.addRequester(requesterConnection)
    }
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.afs.discoveryKey)
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
    // TODO: check that data is signed by requester
    const quote = agreement.getQuote()
    return quote.getPerUnitCost() == this.price
  }

  /**
   * Sign and return a agreement
   * @param {messages.Agreement} agreement
   * @returns {messages.Agreement}
   */
  async signAgreement(agreement) {
    // TODO sign data
    agreement.setFarmerSignature(this.farmerSig)
    return agreement
  }

  async validateSow(sow) {
    // TODO: Validate DID
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
   * Returns whether a reward is valid.
   * @param {messages.Reward} reward
   * @returns {boolean}
   */
  async validateReward(reward) {
    if (reward) return true
    return false
  }

  /**
   * Returns a receipt given a reward.
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

  async onHireConfirmed(agreement, connection) {
    // TODO: put this somewhere internal to connection
    connection.stream.removeAllListeners('data')

    const self = this
    const sow = agreement.getQuote().getSow()
    debug(`Replicating ${this.afs.did} with requester ${sow.getRequester().getDid()}`)
    const sowId = nonceString(sow)
    const { content } = this.afs.partitions.resolve(this.afs.HOME)

    content.on('upload', (_, data) => {
      self.dataTransmitted(sowId, data.length)
    })

    const stream = self.afs.replicate({
      upload: true,
      download: false
    })

    stream.on('end', () => finish())
    stream.on('error', error => finish(error))

    connection.stream.pipe(stream).pipe(connection.stream, { end: false })

    function finish(error) {
      connection.stream.unpipe()
      stream.destroy()

      if (error) {
        connection.close()
        debug(error)
        return
      }
      // TODO: put this somewhere internal to connection
      connection.stream.on('data', connection.onData.bind(connection))
      connection.stream.resume()
    }
  }
}

module.exports = { Farmer }
