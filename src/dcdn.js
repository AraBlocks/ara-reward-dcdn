/* eslint class-methods-use-this: 1 */
const { token: { expandTokenValue } } = require('ara-contracts')
const { matchers, util: { idify } } = require('ara-farming-protocol')
const { create: createAFS } = require('ara-filesystem')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { toBuffer } = require('ara-util/transform')
const { resolve } = require('path')
const { Farmer } = require('./farmer.js')
const { User } = require('./util')
const createHyperswarm = require('./hyperswarm')
const MetadataService = require('./metadata')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const debug = require('debug')('afd')
const pify = require('pify')
const rc = require('./rc')()

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

    // Map from topic to service
    this.services = {}

    // Map from did to topics
    this.topics = {}

    this.queue = opts.queue || new AutoQueue()
    this.swarm = null
    this.user = new User(getIdentifier(opts.userID), opts.password)

    this.root = resolve(rc.network.dcdn.root, this.user.did)
    this.jobs = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_JOB_STORE)
    this.config = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_CONFIG_STORE)
  }

  _onConnection(connection, details) {
    const self = this
    const peer = details.peer || {}
    debug('onconnection:', idify(peer.host, peer.port))
    connection.on('error', (err) => {
      debug('connection error:', err)
    })

    if (peer.topic) {
      process.nextTick(() => {
        listenForTopic()
        connection.write(peer.topic)
      })
    } else {
      listenForTopic((topic) => {
        connection.write(topic)
      })
    }

    function listenForTopic(onTopic) {
      const timeout = setTimeout(() => { connection.destroy() }, constants.DEFAULT_TIMEOUT)
      connection.once('data', (data) => {
        clearTimeout(timeout)
        const topic = data.toString('hex').substring(0, 64)

        if (topic in self.services) {
          self.services[topic].onConnection(connection, details)
          if (onTopic) onTopic(Buffer.from(topic, 'hex'))
        } else {
          connection.destroy()
        }
      })
    }
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

    if (!this.swarm) {
      if (!this.user.secretKey) await this.user.loadKey()
      this.swarm = createHyperswarm()
      this.swarm.on('connection', this._onConnection.bind(this))

      if (!this[$driveCreator]) await this._loadDrive()

      const archives = this[$driveCreator].list()
      for (const archive of archives) {
        if (archive instanceof Error) {
          self.emit('failedArchiving', archive.data, archive.message)
        } else {
          // eslint-disable-next-line no-await-in-loop
          await self._startServices(archive)
        }
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

  async _startServices(afs) {
    const self = this
    if (!afs.dcdnOpts) throw new Error('afs missing dcdn options')

    const {
      dcdnOpts: {
        metaOnly,
        upload,
        download
      }
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')

    if (metaOnly) {
      addService(await this._createMetaService(afs))
    } else if (download) {
      addService(await this._createContentService(afs))
    } else if (upload) {
      addService(await this._createMetaService(afs))
      addService(await this._createContentService(afs))
    }

    function addService(service) {
      if (service) {
        if (!(afs.did in self.topics)) self.topics[afs.did] = []
        const topic = service.topic.toString('hex')
        self.services[topic] = service
        self.topics[afs.did].push(topic)
        service.start()
      }
    }
  }

  async _createContentService(afs) {
    const self = this

    const {
      dcdnOpts: {
        upload,
        download,
        price,
        maxPeers,
        jobId
      },
      dcdnOpts
    } = afs

    let service
    const key = afs.did

    const convertedPrice = (price) ? Number(expandTokenValue(price.toString())) : 0

    if (download) {
      const partition = afs.partitions.home
      if (partition.content) {
        attachProgressListener(partition.content)
      } else {
        partition.once('content', () => {
          attachProgressListener(partition.content)
        })
      }

      let jobNonce = jobId || await this._getJobInProgress(key) || crypto.randomBytes(32)
      if ('string' === typeof jobNonce) jobNonce = toBuffer(jobNonce.replace(/^0x/, ''), 'hex')
      await pify(self.jobsInProgress.write)(jobNonce, key)

      const matcher = new matchers.MaxCostMatcher(convertedPrice, maxPeers)
      service = new Requester(jobNonce, matcher, this.user, afs, this.swarm, this.queue)
      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job.replace(/^0x/, ''))
        await self.unjoin(dcdnOpts)

        // If both upload and download are true, then will immediately start seeding
        if (upload) {
          dcdnOpts.download = false
          await self.join(dcdnOpts)
        }

        /** This is to signify when all farmers have responded
        with receipts and it's safe to publish the afs * */
        self.emit('requestcomplete', key)
      })
    } else if (upload) {
      service = new Farmer(this.user, convertedPrice, afs, this.swarm)
    }

    function attachProgressListener(feed) {
      // Handle when download starts
      feed.once('download', () => {
        debug(`Download ${key} started...`)
        self.emit('start', key, feed.length)
      })

      // Handle when download progress
      feed.on('download', () => {
        self.emit('progress', key, feed.downloaded())
      })

      // Handle when the content finishes downloading
      feed.once('sync', () => {
        self.emit('complete', key)
        debug(`Download ${key} Complete!`)
      })
    }

    return service
  }

  async _createMetaService(afs) {
    const self = this
    const {
      dcdnOpts: {
        upload,
        download
      },
      dcdnOpts
    } = afs

    const service = new MetadataService(afs, this.swarm, afs.dcdnOpts)
    if (download) {
      service.once('complete', async () => {
        await self.unjoin(afs.dcdnOpts)
        if (upload) {
          dcdnOpts.download = false
          await self.join(dcdnOpts)
        }
        self.emit('requestcomplete', afs.did)
      })
    }

    return service
  }

  _stopServices(afs) {
    self.emit('info', `Stopping services for ${afs.did}`)

    if (afs.did in this.topics) {
      for (const topic of this.topics[afs.did]) {
        this.services[topic].stop()
        delete this.services[topic]
      }
      delete this.topics[afs.did]
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
      for (const archive of archives) {
        if (!(archive instanceof Error)) {
          // eslint-disable-next-line no-await-in-loop
          await self._stopServices(archive)
        }
      }
      await pify(this[$driveCreator].disconnect)()

      // TODO: update swarm destruction with hyperswarm v1
      await pify(this.swarm.destroy)()
      this.swarm = null
    }
  }

  /**
   * Join a discovery swarm described by the passed opts
   * @public
   * @param  {String} opts.did
   * @param  {boolean} opts.upload
   * @param  {boolean} opts.download
   * @param  {boolean} opts.metaOnly
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

    if (this.swarm) {
      if (archive instanceof Error) {
        self.emit('warn', `failed to initialize archive with ${archive.data}: ${archive.message}`)
        return
      }
      await this._startServices(archive)
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
      const archives = this[$driveCreator].list()
      const afs = archives.find(archive => key === archive.did)
      if (afs) {
        await this._stopServices(afs)
        await pify(this[$driveCreator].close)(key)
      }
    } catch (err) {
      self.emit('warn', `failed to unjoin a swarm with key ${key}`)
    }
  }

  static async _createAFS(opts, done) {
    const { did } = opts
    self.emit('info', `initializing afs of did ${did}`)

    try {
      const { afs } = await createAFS({ did })
      afs.dcdnOpts = opts
      done(null, afs)
    } catch (err) {
      done(err, null)
    }
  }

  static async _closeAFS(afs, done) {
    self.emit('info', 'closing afs')
    if (afs) await afs.close()
    done()
  }
}

module.exports = FarmDCDN
