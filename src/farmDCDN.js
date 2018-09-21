const multidrive = require('multidrive')
const toilet = require('toiletdb')
const debug = require('debug')('afd')
const pify = require('pify')
const { Requester } = require('./requester.js')
const { messages, matchers} = require('ara-farming-protocol')
const crypto = require('ara-crypto')
const { Farmer } = require('./farmer.js')
const { Wallet } = require('./contract-abi')
const DCDN = require('ara-network-node-dcdn/dcdn')
const { normalize, getIdentifier } = require('ara-identity/did')
const { create: createAFS } = require('ara-filesystem')

const $driveCreator = Symbol('driveCreator')

/**
 * @class Creates a DCDN node
 */
class FarmDCDN extends DCDN {
  /**
   * @param {String} opts.config store.json path
   * @param {String} opts.userID user DID
   * @return {Object}
   */
  constructor(opts = {}) {
    super(opts)

    if (!opts.userID){
      throw new Error('FarmDCDN requires User Identity')
    }

    this.userID = getIdentifier(opts.userID)
    this.wallet = new Wallet(this.userID, opts.password)
    this.services = {}

    // Preload afses from store
    this.config = opts.config || './store.json' 
  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */
  async start() {
    const self = this
    const store = toilet(this.config)

    this[$driveCreator] = await pify(multidrive)(
      store,
      FarmDCDN._createAFS,
      DCDN._closeAFS
    )

    const archives = this[$driveCreator].list()
    archives.forEach(function (archive) {
      if (archive instanceof Error) {
        debug('failed to initialize archive with %j: %s', archive.data, archive.message)
      } else {
        self._startService(archive)
      }
    })
  }

  async _startService(afs){
    console.log("starting service for", afs.did)
    console.log(afs)
    if (!afs.dcdnOpts) throw new Error('afs missing dcdn options')

    const {
      upload,
      download,
      price,
      maxPeers
    } = afs.dcdnOpts

    if (!upload && !download) throw new Error('upload or download must be true')

    this._attachListeners(afs)
    let service

    if (download) {
      const requester = new messages.AraId()
      requester.setDid(this.userID)

      const sow = new messages.SOW()
      sow.setNonce(crypto.randomBytes(32))
      sow.setWorkUnit('Byte')
      // TODO sow.setCurrencyUnit('Ara^-18')
      sow.setRequester(requester)

      const matcher = new matchers.MaxCostMatcher(price, maxPeers)
      service = new Requester(sow, matcher, this.wallet, afs)
    } 
    else if (upload) {
      service = new Farmer(this.wallet, price, afs)
    }

    this.services[afs.did] = service
    service.startBroadcast()
  }

  async _stopService(key){
    this.services[key].stopBroadcast()
    delete this.services[key]
    await pify(this[$driveCreator].close)(key)
  }


  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  stop() {
    const self = this
    const archives = this[$driveCreator].list()
    archives.forEach(function (archive) {
      if (!(archive instanceof Error)) {
        self._stopService(archive.key)
      }
    })
  }

  /**
   * Join a discovery swarm described by the passed opts
   * @public
   * @param  {String} opts.key  DID of AFS
   * @param  {float} opts.price Price to distribute AFS
   * @param  {int} opts.maxPeers
   *
   * @return {null}
   */

  async join(opts) {
    if (this.services[opts.key]) await this._stopService(opts.key)
    const afs = await pify(this[$driveCreator].create)(opts)
    await this._startService(afs)
  }


  static async _createAFS(opts, done) {
    const { key } = opts

    debug(`initializing afs of did ${key}`)
    let afs
    let err = null
    try {
      ({ afs } = await createAFS({ did: key }))
      afs.dcdnOpts = opts
    } catch (e) {
      err = e
    }

    done(err, afs)
  }
}

module.exports = FarmDCDN
