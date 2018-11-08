const { token: { expandTokenValue } } = require('ara-contracts')
const { messages, matchers } = require('ara-farming-protocol')
const { create: createAFS } = require('ara-filesystem')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { toBuffer } = require('ara-util/transform')
const { Farmer } = require('./farmer.js')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const debug = require('debug')('afd')
const pify = require('pify')
const rc = require('./rc')()
const { resolve } = require('path')

const $driveCreator = Symbol('driveCreator')

/**
 * @class Creates a DCDN node
 */
class FarmDCDN extends EventEmitter {
  /**
   * @param {String} opts.userID user DID
   * @return {Object}
   */
  constructor(opts = {}) {
    super()

    if (!opts.userID) {
      throw new Error('FarmDCDN requires User Identity')
    }

    this.services = {}
    this.user = {
      did: getIdentifier(opts.userID),
      password: opts.password
    }
    this.running = false

    this.root = resolve(rc.network.dcdn.root, this.user.did)
    this.jobs = resolve(rc.network.dcdn.root, this.user.did, 'jobs.json')
    this.config = resolve(rc.network.dcdn.root, this.user.did, 'store.json')
  }

  async _loadDrive() {
    // Create root
    await pify(mkdirp)(this.root)

    // Create jobs
    this.jobsInProgress = toilet(this.jobs)
    await pify(this.jobsInProgress.open)()

    // Create config
    const store = toilet(this.config)
    this[$driveCreator] = await pify(multidrive)(
      store,
      FarmDCDN._createAFS,
      FarmDCDN._closeAFS
    )
  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */
  async start() {
    const self = this
    if (!this.running) {
      this.running = true
      if (!this[$driveCreator]) await this._loadDrive()

      const archives = this[$driveCreator].list()
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
    if (!afs.dcdnOpts) throw new Error('afs missing dcdn options')

    const {
      did,
      dcdnOpts: {
        upload,
        download,
        price,
        maxPeers,
        jobId
      },
      dcdnOpts
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')
    debug('starting service for', did)

    const convertedPrice = Number(expandTokenValue(price.toString()))

    this._attachListeners(afs)
    let service

    if (download) {
      let jobNonce = jobId || await this._getJobInProgress(did) || crypto.randomBytes(32)
      if ('string' === typeof jobNonce) jobNonce = toBuffer(jobNonce, 'hex')

      const requester = new messages.AraId()
      requester.setDid(this.user.did)

      const sow = new messages.SOW()
      sow.setNonce(jobNonce)
      sow.setWorkUnit('AFS')
      sow.setCurrencyUnit('Ara^-18')
      sow.setRequester(requester)

      const matcher = new matchers.MaxCostMatcher(convertedPrice, maxPeers)
      service = new Requester(sow, matcher, this.user, afs)
      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job)
        await self.unjoin(dcdnOpts)

        /** This is to signify when all farmers have responded
            with receipts and it's safe to publish the afs * */
        self.emit('requestcomplete', did)

        // If both upload and download are true, then will immediately start seeding
        if (upload) {
          dcdnOpts.download = false
          self.join(dcdnOpts)
        }
      })

      try {
        // TODO: only prepare job if download needed
        await service.prepareJob()
        await pify(self.jobsInProgress.write)(jobNonce, did)
      } catch (err) {
        debug(`failed to start broadcast for ${did}`, err)
        return
      }
    } else if (upload) {
      service = new Farmer(this.user, convertedPrice, afs)
    }

    this.services[did] = service
    service.start()
  }

  _stopService(did) {
    debug('Stopping service for', did)
    if (did in this.services) {
      this.services[did].stop()
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
      const self = this

      const archives = this[$driveCreator].list()
      archives.forEach((archive) => {
        if (!(archive instanceof Error)) {
          self._stopService(archive.did)
        }
      })
      await pify(this[$driveCreator].disconnect)()
      this.running = false
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
   * @param  {String} [opts.jobId]
   * @return {null}
   */
  async join(opts) {
    if (!opts || 'object' !== typeof opts) {
      throw new TypeError('Expecting `opts` to be an object')
    }
    opts.key = opts.key || getIdentifier(opts.did)

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
    if (!opts || 'object' !== typeof opts) {
      throw new TypeError('Expecting `opts` to be an object')
    }

    const key = opts.key || getIdentifier(opts.did)
    if (!this[$driveCreator]) await this._loadDrive()

    try {
      await this._stopService(key)
      const archives = this[$driveCreator].list()
      if (-1 === archives.findIndex(archive => key === archive.did)) return
      await pify(this[$driveCreator].close)(key)
    } catch (err) {
      debug(err)
    }
  }

  static async _createAFS(opts, done) {
    const { did } = opts
    debug(`initializing afs of did ${did}`)

    try {
      const { afs } = await createAFS({ did })
      afs.dcdnOpts = opts
      done(null, afs)
    } catch (err) {
      done(err, null)
    }
  }

  static async _closeAFS(afs, done) {
    debug('closing afs')
    if (afs) await afs.close()
    done()
  }
}

module.exports = FarmDCDN
