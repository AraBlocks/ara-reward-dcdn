const { messages, matchers } = require('ara-farming-protocol')
const { create: createAFS } = require('ara-filesystem')
const { getIdentifier } = require('ara-identity/did')
const { Requester } = require('./requester.js')
const { Farmer } = require('./farmer.js')
const { Wallet } = require('./wallet')
const multidrive = require('multidrive')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const debug = require('debug')('afd')
const pify = require('pify')
const DCDN = require('ara-network-node-dcdn/dcdn')

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
    if (!this.running){
      this.running = true
      const self = this

      this.jobsInProgress = toilet('./jobs.json')
      await pify(this.jobsInProgress.open)()

      const archives = await this._loadDrive()
      archives.forEach(function (archive) {
        if (archive instanceof Error) {
          debug('failed to initialize archive with %j: %s', archive.data, archive.message)
        } else {
          self._startService(archive)
        }
      })
    }
  }

  async _getJobInProgress(did){
    const jobs = await pify(this.jobsInProgress.read)()
    for (let job in jobs){
      if (did === jobs[job]) return job
    }
    return null
  }

  async _startService(afs){
    const self = this
    debug("starting service for", afs.did)
    if (!afs.dcdnOpts) throw new Error('afs missing dcdn options')

    const {
      upload,
      download,
      price,
      maxPeers,
      jobId
    } = afs.dcdnOpts

    if (!upload && !download) throw new Error('upload or download must be true')

    this._attachListeners(afs)
    let service

    if (download) {
      let jobNonce = jobId || await this._getJobInProgress(afs.did) || crypto.randomBytes(32)
      if ('string' === typeof jobNonce) jobNonce = Buffer.from(jobNonce, 'hex')

      const requester = new messages.AraId()
      requester.setDid(this.userID)

      const sow = new messages.SOW()
      sow.setNonce(jobNonce)
      sow.setWorkUnit('Byte')
      sow.setCurrencyUnit('Ara^-18')
      sow.setRequester(requester)

      const matcher = new matchers.MaxCostMatcher(price, maxPeers)
      service = new Requester(sow, matcher, this.wallet, afs)
      service.once('jobcreated', async (job, did) => {
        await pify(self.jobsInProgress.write)(job, did)
      })
      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job)
        await self.unjoin(afs.dcdnOpts)
        
        /** This is to signify when all farmers have responded
            with receipts and it's safe to publish the afs **/
        self.emit('requestcomplete', afs.did)
      })
    } 
    else if (upload) {
      service = new Farmer(this.wallet, price, afs)
    }

    this.services[afs.did] = service
    service.startBroadcast()
  }

  _stopService(did){
    debug("stopping service for", did)
    if (did in this.services){
      this.services[did].stopBroadcast()
      delete this.services[did]
    }
  }

  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  async stop() {
    if (this.running){
      this.running = false
      const self = this
      const archives = await this._loadDrive()
      archives.forEach(function (archive) {
        if (!(archive instanceof Error)) {
          self._stopService(archive.did)
        }
      })
      await pify(this[$driveCreator].disconnect)()
    }
  }

  /**
   * Join a discovery swarm described by the passed opts
   * @public
   * @param  {String} opts.key  DID of AFS
   * @param  {boolean} opts.upload
   * @param  {boolean} opts.download
   * @param  {float} opts.price Price to distribute AFS
   * @param  {int} opts.maxPeers
   * @param  {String} opts.jobId 
   * @return {null}
   */
  async join(opts) {
    if (upload && download){
      throw new Error('both upload and download cannot be true')
    }

    await this.unjoin(opts)
    const archive = await pify(this[$driveCreator].create)(opts)

    if (this.running) {
      if (archive instanceof Error) {
        debug('failed to initialize archive with %j: %s', archive.data, archive.message)
        return
      }
      await this._startService(archive)
    } else {
      await this.start()
    }
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
    try {
      await this._stopService(opts.key)
      await pify(this[$driveCreator].close)(opts.key)
    } catch (err){
      debug(err)
    }
  }

  static async _createAFS(opts, done) {
    const { key: did } = opts

    debug(`initializing afs of did ${did}`)
    let afs
    let err = null
    try {
      ({ afs } = await createAFS({ did }))
      afs.dcdnOpts = opts
    } catch (e) {
      err = e
    }

    done(err, afs)
  }
}

module.exports = FarmDCDN
