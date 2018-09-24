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
    this.configLoaded = false
  }

  async _loadDrive(){
    if (!this[$driveCreator]){
      const store = toilet(this.config)
      this[$driveCreator] = await pify(multidrive)(
        store,
        FarmDCDN._createAFS,
        DCDN._closeAFS
      )
    }
    return this[$driveCreator].list()
  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */
  async start() {
    const self = this
    const archives = await this._loadDrive()
    archives.forEach(function (archive) {
      if (archive instanceof Error) {
        debug('failed to initialize archive with %j: %s', archive.data, archive.message)
      } else {
        self._startService(archive)
      }
    })
  }

  async _startService(afs){
    debug("starting service for", afs.did)
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
      sow.setCurrencyUnit('Ara^-18')
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

  _stopService(key){
    debug("stopping service for", key)
    if (key in this.services){
      this.services[key].stopBroadcast()
      delete this.services[key]
    }
  }

  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  async stop() {
    const self = this
    const archives = await this._loadDrive()
    archives.forEach(function (archive) {
      if (!(archive instanceof Error)) {
        self._stopService(archive.key)
      }
    })
    await pify(this[$driveCreator].disconnect)()
  }

  /**
   * Join a discovery swarm described by the passed opts
   * @public
   * @param  {String} opts.key  DID of AFS
   * @param  {boolean} opts.upload
   * @param  {boolean} opts.download
   * @param  {float} opts.price Price to distribute AFS
   * @param  {int} opts.maxPeers
   *
   * @return {null}
   */
  async join(opts) {
    await this.unjoin(opts)
    const afs = await pify(this[$driveCreator].create)(opts)
    await this._startService(afs)
  }

  /**
   * Unjoin a discovery swarm described by the passed opts
   * @public
   * @param  {String} opts.key  DID of AFS
   *
   * @return {null}
   */
  async unjoin(opts) {
    opts.key = getIdentifier(opts.key)
    await this._loadDrive()
    await this._stopService(opts.key)
    await pify(this[$driveCreator].close)(opts.key)
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
