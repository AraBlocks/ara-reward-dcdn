/* eslint class-methods-use-this: 1 */
const { token, registry } = require('ara-contracts')
const { matchers, util: { idify } } = require('ara-reward-protocol')
const { create: createAFS, getPrice } = require('ara-filesystem')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { toBuffer } = require('ara-util/transform')
const { resolve } = require('path')
const { Farmer } = require('./farmer.js')
const { isUpdateAvailable } = require('./util')
const createHyperswarm = require('./hyperswarm')
const MetadataService = require('./metadata')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const debug = require('debug')('ard')
const pify = require('pify')
const User = require('./user')
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
    debug('connection open:', idify(peer.host, peer.port), 'topic:', peer.topic)
    connection.on('error', (err) => {
      debug('connection error:', idify(peer.host, peer.port), 'err:', err)
    })
    connection.once('close', () => {
      debug('connection close:', idify(peer.host, peer.port), 'topic:', peer.topic)
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
      const timeout = setTimeout(() => {
        connection.destroy()
      }, constants.DEFAULT_TIMEOUT)

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
      if (!this.user.secretKey) {
        try {
          await this.user.loadKey()
        } catch (err) {
          throw (err)
        }
      }
      this.swarm = createHyperswarm()
      this.swarm.on('connection', this._onConnection.bind(this))

      if (!this[$driveCreator]) await this._loadDrive()

      const archives = this[$driveCreator].list()
      for (const archive of archives) {
        if (archive instanceof Error) {
          self.emit('warn', `failed to initialize archive with ${archive.data.did}: ${archive.message}`)
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
    if (!afs.dcdn) throw new Error('afs missing dcdn options')

    const {
      dcdn: {
        metaOnly,
        upload,
        download
      }
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')

    if (metaOnly) {
      addService(await this._createMetadataService(afs))
    } else {
      // TODO: sync etc within content service
      addService(await this._createMetadataService(afs))
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

    let {
      dcdn: {
        price
      }
    } = afs

    const {
      dcdn: {
        upload,
        download,
        maxPeers = constants.DEFAULT_MAX_PEERS,
        jobId
      },
      dcdn: opts
    } = afs

    let service
    const key = afs.did

    // Default reward to a percentage of the content's price
    if (null === price || undefined === price) {
      try {
        price = constants.DEFAULT_REWARD_PERCENTAGE * await getPrice({ did: afs.did })
      } catch (err) {
        debug(err)
        price = 0
      }
    }
    const convertedPrice = (price) ? Number(token.expandTokenValue(price.toString())) : 0

    if (download) {
      if (!(await isUpdateAvailable(afs))) {
        this.emit('info', `No content update available for ${afs.did}`)
        return null
      }

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

      service.once('downloadcomplete', async () => {
        debug(`Download ${key} Complete!`)
        self.emit('complete', key)
      })

      service.once('jobcomplete', async (job) => {
        await pify(self.jobsInProgress.delete)(job.replace(/^0x/, ''))
      })

      service.once('requestcomplete', async () => {
        await self.unjoin(opts)

        // If both upload and download are true, then will immediately start seeding
        if (upload) {
          opts.download = false
          await self.join(opts)
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
      // TODO: handle if length changes, i.e., new update
      feed.once('download', () => {
        debug(`Download ${key} started...`)
        self.emit('start', key, feed.length)
      })

      // Handle when download progress
      feed.on('download', () => {
        self.emit('progress', key, feed.downloaded(), feed.length)
      })
    }

    return service
  }

  async _createMetadataService(afs) {
    const service = new MetadataService(afs, this.swarm, afs.dcdn)
    return service
  }

  _stopServices(afs) {
    this.emit('info', `Stopping services for ${afs.did}`)

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
        this.emit('warn', `Failed to initialize archive with ${archive.data}: ${archive.message}`)
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
      this.emit('warn', `Failed during unjoin of did ${key} with error: ${err}`)
    }
  }

  static async _createAFS(opts, done) {
    const { did } = opts
    try {
      // TODO: only sync latest
      const { afs } = await createAFS({
        did,
        partitions: {
          etc: {
            sparse: true
          }
        }
      })
      afs.dcdn = opts

      // TODO: factor this into ara-filesystem
      afs.proxy = await registry.getProxyAddress(did)

      afs.on('error', () => {
        // TODO: properly handle afs errors
      })

      done(null, afs)
    } catch (err) {
      done(err, null)
    }
  }

  static async _closeAFS(afs, done) {
    try {
      if (afs && afs.close) await afs.close()
    } catch (err) {
      debug('afs close error:', err)
    }
    done()
  }
}

module.exports = FarmDCDN
