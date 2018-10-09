const { messages, matchers, util: { etherToWei } } = require('ara-farming-protocol')
const { create: createAFS } = require('ara-filesystem')
const { getIdentifier } = require('ara-identity/did')
const { Requester } = require('./requester.js')
const { Farmer } = require('./farmer.js')
const multidrive = require('multidrive')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const debug = require('debug')('afd')
const pify = require('pify')
const DCDN = require('ara-network-node-dcdn/dcdn')
const {
  DEFAULT_CONFIG_STORE,
  DEFAULT_JOB_STORE
} = require('../constants')

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

    if (!opts.userID) {
      throw new Error('FarmDCDN requires User Identity')
    }

    this.services = {}
    this.user = {
      did: getIdentifier(opts.userID),
      password: opts.password
    }

    // Preload afses from store
    this.config = opts.config || DEFAULT_CONFIG_STORE
  }

  async _loadDrive() {
    if (!this[$driveCreator]) {
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
    if (!this.running) {
      this.running = true
      const self = this

      this.jobsInProgress = toilet(DEFAULT_JOB_STORE)
      await pify(this.jobsInProgress.open)()

      const archives = await this._loadDrive()
      archives.forEach((archive) => {
        if (archive instanceof Error) {
          debug('failed to initialize archive with %j: %s', archive.data, archive.message)
        } else {
          self._startService(archive)
        }
      })
    }
  }

  async _getJobInProgress(did) {
    const jobs = await pify(this.jobsInProgress.read)()
    for (const job in jobs) {
      if (did === jobs[job]) return job
    }
    return null
  }

  _attachListeners(afs) {
    const self = this

    const {
      dcdnOpts: {
        download
      }
    } = afs

    if (download) {
      const { content } = afs.partitions.resolve(afs.HOME)
      if (content) {
        attachDownloadListener(content)
      } else {
        afs.once('content', () => {
          attachDownloadListener(afs.partitions.resolve(afs.HOME).content)
        })
      }
    }

    // Emit download events
    function attachDownloadListener(feed) {
      // Handle when download starts
      feed.once('download', () => {
        debug(`Download ${afs.did} started...`)
        self.emit('start', afs.did, feed.length)
      })

      // Handle when download progress
      feed.on('download', () => {
        self.emit('progress', afs.did, feed.downloaded())
      })

      // Handle when the content finishes downloading
      feed.once('sync', () => {
        self.emit('complete', afs.did)
        debug(`Download ${afs.did} Complete!`)
      })
    }
  }

  async _startService(afs) {
    const self = this
    debug('starting service for', afs.did)
    if (!afs.dcdnOpts) throw new Error('afs missing dcdn options')

    const {
      dcdnOpts: {
        upload,
        download,
        price,
        maxPeers,
        jobId
      }
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')

    // TODO: use Ara to Ara^-18
    const convertedPrice = etherToWei(price)

    this._attachListeners(afs)
    let service

    if (download) {
      let jobNonce = jobId || await this._getJobInProgress(afs.did) || crypto.randomBytes(32)
      if ('string' === typeof jobNonce) jobNonce = Buffer.from(jobNonce, 'hex')

      const requester = new messages.AraId()
      requester.setDid(this.user.did)

      const sow = new messages.SOW()
      sow.setNonce(jobNonce)
      sow.setWorkUnit('AFS')
      sow.setCurrencyUnit('Ara^-18')
      sow.setRequester(requester)

      const matcher = new matchers.MaxCostMatcher(convertedPrice, maxPeers)
      service = new Requester(sow, matcher, this.user, afs)
      service.once('jobcreated', async (job, did) => {
        await pify(self.jobsInProgress.write)(job, did)
      })
      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job)
        await self.unjoin(afs.dcdnOpts)

        /** This is to signify when all farmers have responded
            with receipts and it's safe to publish the afs * */
        self.emit('requestcomplete', afs.did)
      })
    } else if (upload) {
      service = new Farmer(this.user, convertedPrice, afs)
    }

    this.services[afs.did] = service
    await service.startBroadcast()
  }

  _stopService(did) {
    debug('stopping service for', did)
    if (did in this.services) {
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
    if (this.running) {
      this.running = false
      const self = this
      const archives = await this._loadDrive()
      archives.forEach((archive) => {
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
   * @param  {String} opts.did
   * @param  {boolean} opts.upload
   * @param  {boolean} opts.download
   * @param  {float} opts.price Price to distribute AFS
   * @param  {int} opts.maxPeers
   * @param  {String} opts.jobId
   * @return {null}
   */
  async join(opts) {
    if (opts.upload && opts.download) {
      throw new Error('both upload and download cannot be true')
    }

    opts.key = getIdentifier(opts.did)

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
   * @param  {String} opts.did
   *
   * @return {null}
   */
  async unjoin(opts) {
    const key = opts.key || getIdentifier(opts.did)
    await this._loadDrive()
    try {
      await this._stopService(key)
      await pify(this[$driveCreator].close)(key)
    } catch (err) {
      debug(err)
    }
  }

  static async _createAFS(opts, done) {
    const { did } = opts

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
