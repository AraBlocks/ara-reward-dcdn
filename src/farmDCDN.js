const { messages, matchers, util: { etherToWei } } = require('ara-farming-protocol')
const { create: createAFS } = require('ara-filesystem')
const { getIdentifier } = require('ara-identity/did')
const { Requester } = require('./requester.js')
const { Farmer } = require('./farmer.js')
const createHyperswarm = require('@hyperswarm/network')
const multidrive = require('multidrive')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const debug = require('debug')('afd')
const pify = require('pify')
const DCDN = require('ara-network-node-dcdn/dcdn')
const rc = require('./rc')()

const $driveCreator = Symbol('driveCreator')

/**
 * @class Creates a DCDN node
 */
class FarmDCDN extends DCDN {
  /**
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
  }

  async _loadDrive() {
    // Create root
    await pify(mkdirp)(rc.dcdn.root)

    // Create jobs
    this.jobsInProgress = toilet(rc.dcdn.jobs)
    await pify(this.jobsInProgress.open)()

    // Create config
    const store = toilet(rc.dcdn.config)
    this[$driveCreator] = await pify(multidrive)(
      store,
      FarmDCDN._createAFS,
      DCDN._closeAFS
    )
  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */
  async start() {
    if (!this.swarm) {
      this.swarm = createHyperswarm()
      this.swarm.on('connection', handleConnection)
      const self = this

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

    function handleConnection(socket, details) {
      const peer = details.peer || {}
      debug(`Peer Swarm: Peer connected: ${idify(peer.host, peer.port)}`)
      if (peer.topic && self.services[peer.topic.toString('hex')]) {
        self.services[peer.topic.toString('hex')].addConnection(peer, socket)
      }
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
      }
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')
    debug('starting service for', did)

    // TODO: use Ara to Ara^-18
    const convertedPrice = etherToWei(price)

    this._attachListeners(afs)
    let service
    let opts

    if (download) {
      opts = { lookup: true, announce: false }

      let jobNonce = jobId || await this._getJobInProgress(did) || crypto.randomBytes(32)
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
      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job)
        await self.unjoin(afs.dcdnOpts)

        /** This is to signify when all farmers have responded
            with receipts and it's safe to publish the afs * */
        self.emit('requestcomplete', did)
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
      opts = { lookup: false, announce: true }
      service = new Farmer(this.user, convertedPrice, afs)
    }

    this.services[did] = service
    this.swarm.join(Buffer.from(did, 'hex'), opts)
    debug('Broadcasting: ', did)
  }

  _stopService(did) {
    debug('Stopping service for', did)
    if (did in this.services) {
      this.swarm.leave(Buffer.from(did, 'hex'))
      delete this.services[did]
    }
  }

  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  async stop() {
    if (this.swarm) {
      const self = this

      const archives = this[$driveCreator].list()
      archives.forEach((archive) => {
        if (!(archive instanceof Error)) {
          self._stopService(archive.did)
        }
      })
      await pify(this[$driveCreator].disconnect)()
      this.swarm = null
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

    if (this.swarm) {
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
    if (!this[$driveCreator]) await this._loadDrive()
      
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
