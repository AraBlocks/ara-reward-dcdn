const { createSwarm } = require('ara-network/discovery/swarm')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const through = require('through')
const toilet = require('toiletdb')
const debug = require('debug')('afd')
const pify = require('pify')
const { Requester } = require('./requester.js')
const { messages, util, matchers} = require('ara-farming-protocol')
const crypto = require('ara-crypto')
const { Farmer } = require('./farmer.js')
const { Wallet } = require('./contract-abi')
const DCDN = require('ara-network-node-dcdn/dcdn')
const $driveCreator = Symbol('driveCreator')
/**
 * @class Creates a DCDN node
 */
class FarmDCDN extends DCDN {
  /**
   * @param {String} opts.did Static DID for syncing
   * @param {Boolean} opts.upload Whether to upload files
   * @param {Boolean} opts.download Whether to download files
   * @param {String} opts.userID
   * @param {int} opts.price
   * @param {int} opts.maxWorkers
   * @return {Object}
   */
  constructor(opts = {}) {
    super(opts)
    this.setupUser(opts)
  }

  setupUser(opts){
    if (!opts.userID){
      throw new Error('FarmDCDN requires User Identity')
    }

    const user = new messages.AraId()
    user.setDid(opts.userID)

    //TODO: this is where we'll use the password to get the private key in order to sign things
    const userSig = new messages.Signature()
    userSig.setAraId(user)
    userSig.setData('userSig')

    const wallet = new Wallet(opts.userID, opts.password)

    if (opts.upload){
      this.user = new Farmer(user, userSig, opts.price, wallet)
    }
    else if (opts.download){
      const sow = new messages.SOW()
      sow.setNonce(crypto.randomBytes(32))
      sow.setWorkUnit('Byte')
      sow.setRequester(user)

      const matcher = new matchers.MaxCostMatcher(opts.price, opts.maxWorkers)
      this.user = new Requester(sow, matcher, userSig, wallet)
    }
  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */

  async start() {
    //TODO: add price and ability to update in the store file
    const store = toilet('./afses.json')
    this[$driveCreator] = await pify(multidrive)(
      store,
      DCDN._createAFS,
      DCDN._closeAFS
    )
    this.join(this.did)
  }


  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  stop() {
    this.user.stopService()
  }

  /**
   * Join a discovery swarm described by the passed DID
   * @public
   * @param  {String} did DID to join swarm of
   *
   * @return {null}
   */

  async join(did) {
    if (!this.user){
      throw new Error('FarmDCDN requires User Identity')
    }

    this.afses[did] = await pify(this[$driveCreator].create)(did)
    this._attachListeners(this.afses[did])

    this.user.broadcastService(this.afses[did], this.swarm)
  }
}

module.exports = FarmDCDN
