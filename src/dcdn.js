/* eslint class-methods-use-this: 1 */
const { matchers, util: { idify } } = require('ara-reward-protocol')
const { create: createAFS } = require('ara-filesystem')
const { token, registry } = require('ara-contracts')
const { getIdentifier } = require('ara-util')
const { Requester } = require('./requester.js')
const { resolve } = require('path')
const { Farmer } = require('./farmer.js')
const AutoQueue = require('./autoqueue')
const constants = require('./constants')
const BaseDCDN = require('ara-network-node-dcdn/dcdn')
const ardUtil = require('./util')
const crypto = require('ara-crypto')
const toilet = require('toiletdb')
const mkdirp = require('mkdirp')
const debug = require('debug')('ard')
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
    super(Object.assign({
      fs: {
        create: async (opts) => {
          const { afs } = await createAFS(opts)

          return afs
        }
      }
    }, opts))

    // Map from topic to service
    this.services = {}

    // Map from did to topics
    this.topics = {}

    this.queue = opts.queue || new AutoQueue()
    this.user = new User(getIdentifier(opts.userId), opts.password)
    this.jobsInProgress = null

    this.root = resolve(rc.network.dcdn.root, this.user.did)
    this.config = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_CONFIG_STORE)
    this.jobs = resolve(rc.network.dcdn.root, this.user.did, constants.DEFAULT_JOB_STORE)
  }

  pipeReplicate(socket, details, { topic }) {
    this.services[topic].onConnection(socket, details)
  }

  async initialize() {
    await super.initialize()

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

    const self = this

      console.log("ONCON:", super.pipeReplicate, super.onconnection)
    this.swarm.on('connection', super.onconnection)

    if (!this.user.secretKey) {
      await this.user.loadKey()
    }

    const archives = super.drives.list()

    if (0 === archives.length) {
      this._info('no previous config')
      return
    }

      if (0 === archives.length) {
        this._info('no previous config')
        return
      }

    for (const archive of archives) {
      if (archive instanceof Error) {
        this._warn(`failed to initialize archive with ${archive.data.did}: ${archive.message}`)
      } else {
        // eslint-disable-next-line no-await-in-loop
        await self._startServices(archive)
      }
    }
  }

  async _getJobInProgress(did) {
    const jobs = await pify(this.jobsInProgress.read)()

    return jobs.filter(j => did === jobs[j])[0]
  }

  async _startServices(afs) {
    const addService = (service) => {
      if (service) {
        if (!(afs.did in self.topics)) self.topics[afs.did] = []
        const topic = service.topic.toString('hex')
        self.services[topic] = service
        self.topics[afs.did].push(topic)
        service.on('info', super._info)
        service.start()
      }
    }

    const self = this
    if (!afs.dcdn) throw new Error('afs missing dcdn options')

    const {
      dcdn: {
        upload,
        download
      }
    } = afs

    addService(await this._createContentService(afs))
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
        super._info(`No content update available for ${afs.did}`)
        return null
      }

      let jobNonce = jobId || await this._getJobInProgress(key) || crypto.randomBytes(32)

      if ('string' === typeof jobNonce) jobNonce = Buffer.from(jobNonce.replace(/^0x/, ''), 'hex')
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

  _stopServices(did) {
    this._info(`Stopping services for: ${did}`)
    if (did in this.topics) {
      for (const topic of this.topics[did]) {
        this.services[topic].stop()
        this.services[topic].removeAllListeners()
        delete this.services[topic]
      }
      delete this.topics[did]
    }
  }

  /**
   * Stop running the DCDN node
   * @public
   * @return {null}
   */
  async stop() {
    const self = this

    const archives = super.drives.list()
    for (const archive of archives) {
      if (!(archive instanceof Error)) {
        // eslint-disable-next-line no-await-in-loop
        await self._stopServices(archive.did)
      }
    }

    await super.stop()
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

    try {
      const afs = await super.join(opts)
      if (afs) {
        await this._startServices(afs)
      } else {
        this._warn(`Failed during join and starting of ${opts.key} due to not instantiating an AFS`)
      }
    } catch (err) {
      console.error(err)
      this._warn(`Failed during join and starting of ${opts.key} with error: ${err}`)
    }

    if (this.swarm) {
      if (archive instanceof Error) {
        this._warn(`failed to initialize archive with ${archive.data.did}: ${archive.message}`)
        return
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

<<<<<<< HEAD
    const key = opts.key || getIdentifier(opts.did)
      await this._stopServices(opts.did)
    super.unjoin({ key })
=======
    opts.key = opts.key || getIdentifier(opts.did)

    try {
      await super.unjoin(opts)
      await this._stopServices(opts.key)
    } catch (err) {
     this._warn(`Failed during unjoin of did ${opts.key} with error: ${err}`)
    }
>>>>>>> refactor(src/dcdn.js): Integrate agnostic DCDN
  }
}

module.exports = DCDN
