/* eslint class-methods-use-this: 1 */
const { token, registry } = require('ara-contracts')
const { matchers, util: { idify } } = require('ara-reward-protocol')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { toBuffer } = require('ara-util/transform')
const { resolve } = require('path')
const { Farmer } = require('./farmer.js')
const EventEmitter = require('events')
const hyperswarm = require('./hyperswarm')
const multidrive = require('multidrive')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const ardUtil = require('./util')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const araFS = require('ara-filesystem')
const debug = require('debug')('ard')
const pify = require('pify')
const User = require('./user')
const rc = require('./rc')()

const $driveCreator = Symbol('driveCreator')

/**
 * @class A rewardable DCDN node on the Ara Network
 * @fires DCDN#info
 * @fires DCDN#warn
 * @fires DCDN#peer-update
 * @fires DCDN#download-progress
 * @fires DCDN#download-complete
 * @fires DCDN#request-complete
 */
class DCDN extends EventEmitter {
  /**
   * Constructs a new dcdn instance
   * @param {String} opts.userId The user's `did`
   * @param {String} opts.password The user's password
   * @param {Object} [opts.queue] The transaction queue
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
    this.user = new User(getIdentifier(opts.userId), opts.password)
    this.jobsInProgress = null

    this.root = resolve(rc.network.dcdn.root, this.user.did)
    this.jobs = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_JOB_STORE)
    this.config = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_CONFIG_STORE)
  }

  _info(message) {
    /**
     * Informational event
     * @event DCDN#info
     * @param {string} message Helpful information about the state of the DCDN Node
     */
    this.emit('info', message)
  }

  _warn(message) {
    /**
     * Warning event
     * @event DCDN#warn
     * @param {string} message Warning information about the state of the DCDN Node
     */
    this.emit('warn', message)
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
      DCDN._createAFS,
      DCDN._closeAFS
    )
  }

  /**
   * Start running the DCDN node in the latest configuration
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

      this.swarm = hyperswarm.create()
      this.swarm.on('connection', this._onConnection.bind(this))

      if (!this[$driveCreator]) await this._loadDrive()

      const archives = this[$driveCreator].list()

      if (0 === archives.length) {
        this._info('no previous config')
        return
      }
      for (const archive of archives) {
        if (archive instanceof Error) {
          self._warn(`failed to initialize archive with ${archive.data.did}: ${archive.message}`)
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
        upload,
        download
      }
    } = afs

    if (!upload && !download) throw new Error('upload or download must be true')

    addService(await this._createContentService(afs))

    function addService(service) {
      if (service) {
        if (!(afs.did in self.topics)) self.topics[afs.did] = []
        const topic = service.topic.toString('hex')
        self.services[topic] = service
        self.topics[afs.did].push(topic)
        service.on('info', self._info.bind(self))
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
        metaOnly,
        jobId
      },
      dcdn: opts
    } = afs

    let service
    const key = afs.did

    // Default reward to a percentage of the content's price
    if (null === price || undefined === price) {
      try {
        price = Number(token.expandTokenValue(await araFS.getPrice({ did: afs.did }))) * constants.DEFAULT_REWARD_PERCENTAGE
      } catch (err) {
        debug(err)
        price = 0
      }
    } else {
      price = Number(token.expandTokenValue(price.toString()))
    }

    if (download) {
      if (!metaOnly && !(await ardUtil.isUpdateAvailable(afs))) {
        this._info(`No content update available for ${afs.did}`)
        return null
      }

      let jobNonce = jobId || await this._getJobInProgress(key) || crypto.randomBytes(32)

      if ('string' === typeof jobNonce) jobNonce = toBuffer(jobNonce.replace(/^0x/, ''), 'hex')
      await pify(self.jobsInProgress.write)(jobNonce, key)

      const matcher = new matchers.MaxCostMatcher(price, maxPeers)
      service = new Requester({
        jobId: jobNonce,
        matcher,
        user: this.user,
        afs,
        swarm: this.swarm,
        queue: this.queue,
        metaOnly
      })

      service.once('download-complete', async () => {
        debug(`Download ${key} Complete!`)
        /**
         * Emitted when the download is complete and the data is ready
         * @event DCDN#download-complete
         * @param {string} did The `did` of the downloaded AFS
         */
        self.emit('download-complete', key)
      })

      service.once('job-complete', async (job) => {
        await pify(self.jobsInProgress.delete)(job.replace(/^0x/, ''))
      })

      service.once('request-complete', async () => {
        await self.unjoin(opts)

        // If both upload and download are true, then will immediately start seeding
        if (upload) {
          opts.download = false
          await self.join(opts)
        }

        /**
         * Emitted when the peers have been rewarded and the job is complete
         * @event DCDN#request-complete
         * @param {string} did The `did` of the downloaded AFS
         */
        self.emit('request-complete', key)
      })
    } else if (upload) {
      service = new Farmer({
        user: this.user,
        price,
        afs,
        swarm: this.swarm,
        metaOnly
      })
    }

    const partition = afs.partitions.home
    if (partition.content) {
      attachProgressListener(partition.content)
    } else {
      partition.once('content', () => {
        attachProgressListener(partition.content)
      })
    }

    function attachProgressListener(feed) {
      // Handle when download progress
      feed.on('download', () => {
        /**
         * Emitted when a new data block has been downloaded
         * @event DCDN#download-progress
         * @param {string} did The `did` of the AFS
         * @param {int} downloaded The current number of downloaded blocks
         * @param {int} total The total number of blocks
         */
        self.emit('download-progress', key, feed.downloaded(), feed.length)
      })

      feed.on('peer-add', () => {
        /**
         * Emitted when a peer has been added or removed from an AFS
         * @event DCDN#peer-update
         * @param {string} did The `did` of the AFS
         * @param {int} count The current number of peers
         */
        self.emit('peer-update', key, feed.peers.length)
      })

      feed.on('peer-remove', () => {
        self.emit('peer-update', key, feed.peers.length)
      })
    }

    return service
  }

  _stopServices(afs) {
    this._info(`Stopping services for: ${afs.did}`)
    if (afs.did in this.topics) {
      for (const topic of this.topics[afs.did]) {
        this.services[topic].stop()
        this.services[topic].removeAllListeners()
        delete this.services[topic]
      }
      delete this.topics[afs.did]
    }
  }

  /**
   * Stop running the DCDN node
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
   * Joins a hyperswarm for a given AFS and replicates for a reward.
   * Adds the options to the node's configuration. **Note**: this will
   * also start the node and load the previous configuration.
   * @public
   * @param  {String} opts.did The `did` of the AFS
   * @param  {boolean} opts.upload Whether to seed the AFS
   * @param  {boolean} opts.download Whether to download the AFS
   * @param  {boolean} [opts.metaOnly] Whether to only replicate the metadata
   * @param  {float} [opts.price] Price to distribute AFS
   * @param  {int} [opts.maxPeers] The maximum peers for the AFS
   * @param  {String} [opts.jobId] A job id for the AFS
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
        this._warn(`failed to initialize archive with ${archive.data.did}: ${archive.message}`)
        return
      }
      await this._startServices(archive)
    } else {
      await this.start()
    }
  }

  /**
   * Leaves a hyperswarm for a given AFS and removes its options
   * from the node's configuration
   * @public
   * @param  {String} opts.did The `did` of the AFS
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
      this._warn(`Failed during unjoin of did ${key} with error: ${err}`)
    }
  }

  static async _createAFS(opts, done) {
    const { did } = opts
    try {
      // TODO: only sync latest
      const { afs } = await araFS.create({
        did,
        partitions: {
          etc: {
            sparse: true
          }
        }
      })

      // TODO: factor this into ara-filesystem
      afs.proxy = await registry.getProxyAddress(did)
      if (!afs.proxy) {
        await afs.close()
        throw new Error(`No proxy found for AFS ${did}`)
      }
      if (!(afs.ddo.proof && await ardUtil.verify(afs.ddo))) {
        await afs.close()
        throw new Error(`DDO unverified for AFS ${did}`)
      }

      afs.dcdn = opts

      afs.on('error', () => {
        // TODO: properly handle afs errors
      })

      done(null, afs)
    } catch (err) {
      err.data = opts
      done(null, err)
    }
  }

  static async _closeAFS(afs, done) {
    try {
      if (afs && afs.close) await afs.close()
      done()
    } catch (err) {
      done(err)
    }
  }
}

module.exports = DCDN
