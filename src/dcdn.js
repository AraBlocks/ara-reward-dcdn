/* eslint class-methods-use-this: 1 */
const { matchers, util: { idify } } = require('ara-reward-protocol')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { toBuffer } = require('ara-util/transform')
const { registry } = require('ara-contracts')
const { resolve } = require('path')
const { Farmer } = require('./farmer.js')
const EventEmitter = require('events')
const hyperswarm = require('./hyperswarm')
const multidrive = require('multidrive')
const discovery = require('@hyperswarm/discovery')
const BigNumber = require('bignumber.js')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const BaseDCDN = require('ara-base-dcdn/dcdn')
const ardUtil = require('./util')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const araFS = require('ara-filesystem')
const debug = require('debug')('ara:rewards:dcdn')
const pify = require('pify')
const User = require('./user')
const rc = require('./rc')()

/**
 * @class A rewardable DCDN node on the Ara Network
 * @fires DCDN#info
 * @fires DCDN#warn
 * @fires DCDN#peer-update
 * @fires DCDN#download-progress
 * @fires DCDN#download-complete
 * @fires DCDN#request-complete
 */
class DCDN extends BaseDCDN {
  /**
   * Constructs a new dcdn instance
   * @param {String} opts.userId The user's `did`
   * @param {String} opts.password The user's password
   * @param {Object} [opts.queue] The transaction queue
   * @return {Object}
   */
  constructor(opts = {}) {
    super(Object.assign(opts, {
      fs: {
        create: async (params) => {
          const { afs } = await araFS.create(params)

          return afs
        }
      }
    }))

    // Map from topic to service
    this.services = {}

    // Map from did to topics
    this.topics = {}

    this.queue = opts.queue || new AutoQueue()
    this.user = new User(getIdentifier(opts.userId), opts.password)
    this.jobsInProgress = null

    this.root = resolve(rc.network.dcdn.root, this.user.did)
    this.jobs = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_JOB_STORE)
    this.config = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_CONFIG_STORE)
  }

  pipeReplicate(socket, details, { topic }) {
    if (topic in this.services) {
      this.services[topic].onConnection(socket, details)
    }
  }

  async _loadDrive() {
    // Create root
    await pify(mkdirp)(this.root)

    // Create jobs
    this.jobsInProgress = toilet(this.jobs)
    await pify(this.jobsInProgress.open)()
  }

  /**
   * Start running the DCDN node in the latest configuration
   * @public
   * @return {null}
   */
  async start() {
    await super.start()

    if (!this.user.secretKey) {
      try {
        await this.user.loadKey()
      } catch (err) {
        throw (err)
      }
    }

    await this._loadDrive()

    const archives = this.drives.list()

    if (0 === archives.length) {
      this._info('no previous config')
      return
    }
    for (const archive of archives) {
      if (archive instanceof Error) {
        this._warn(`failed to initialize archive with ${archive.data.did}: ${archive.message}`)
      } else {
        /* eslint-disable no-await-in-loop */
        archive.proxy = await registry.getProxyAddress(archive.key.toString('hex'))
        await this._startServices(archive)
        /* eslint-enable no-await-in-loop */
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
        price = BigNumber(await araFS.getPrice({ did: afs.did })).multipliedBy(constants.DEFAULT_REWARD_PERCENTAGE).toString()
      } catch (err) {
        debug(err)
        price = '0'
      }
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
    await super.stop()

    if (this.swarm) {
      const archives = this.drives.list()
      for (const archive of archives) {
        if (!(archive instanceof Error)) {
          // eslint-disable-next-line no-await-in-loop
          await this._stopServices(archive)
        }
      }
      await pify(this.drives.disconnect)()
      await pify(this.swarm.destroy)()
      this.swarm = null
    }
  }

  /**
   * Determines peer count for an AFS _before_ purchase.
   * @public
   * @param  {String} opts.did The `did` of the AFS
   * @fires  DCDN#peer-update
   */
  dryRunJoin(opts) {
    if (!opts || 'object' !== typeof opts) {
      throw new TypeError('Expecting `opts` to be an object')
    }
    const self = this
    const did = getIdentifier(opts.did)
    const discoveryKey = crypto.discoveryKey(Buffer.from(did))
    const d = discovery()
    const topic = d.announce(discoveryKey, {
      port: 0,
      lookup: true
    })

    const interval = setInterval(() => {
      clearInterval(interval)
      topic.destroy()
      debug('no peer found; destroying topic channel %s', discoveryKey.toString('hex'))
    }, constants.DEFAULT_TIMEOUT)

    topic.on('peer', () => {
      debug('peer found with discoveryKey: %s & did: %s', discoveryKey.toString('hex'), did)
      self.emit('peer-update', discoveryKey, 1)
      clearInterval(interval)
      topic.destroy()
    })
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
   * @param  {string} [opts.price] Price in Ara to distribute AFS
   * @param  {int} [opts.maxPeers] The maximum peers for the AFS
   * @param  {String} [opts.jobId] A job id for the AFS
   * @return {AFS} Joined AFS
   */
  async join(opts) {
    if (!opts || 'object' !== typeof opts) {
      throw new TypeError('Expecting `opts` to be an object')
    }

    if (!this.swarm) {
      await this.start()
    }

    opts.key = opts.key || getIdentifier(opts.did)
    await this.unjoin(opts)
    const archive = await super.join(opts)
    archive.proxy = await registry.getProxyAddress(opts.key)
    await this._startServices(archive)

    return archive
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
    if (!this.drives) await this._loadDrive()

    try {
      const archives = this.drives.list()
      const afs = archives.find(archive => key === archive.did)
      if (afs) {
        await this._stopServices(afs)
        await super.unjoin({ key })
      }
    } catch (err) {
      this._warn(`Failed during unjoin of did ${key} with error: ${err}`)
    }
  }
}

module.exports = DCDN
