const { create: createAFS } = require('ara-filesystem')
const { info, error } = require('ara-console')
const { createSwarm } = require('ara-network/discovery/swarm')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const through = require('through')
const toilet = require('toiletdb')
const debug = require('debug')('ara:dcdn:dcdn')
const pify = require('pify')

const $driveCreator = Symbol('driveCreator')

/**
 * @class Creates a DCDN node
 */
class DCDN extends EventEmitter {
  /**
   * @param {String} opts.did Static DID for syncing
   * @param {Boolean} opts.upload Whether to upload files
   * @param {Boolean} opts.download Whether to download files
   * @return {Object}
   */
  constructor(opts = {}) {
    super()
    this[$driveCreator] = null
    this.afses = {}
    this.did = opts.did
    this.swarm = createSwarm({ stream: this.stream.bind(this) })
    this.shouldUpload = Boolean(opts.upload)
    this.shouldDownload = Boolean(opts.download)
    this.user = opts.user

  }

  /**
   * Start running the DCDN node
   * @public
   * @return {null}
   */
  async start() {
    const store = toilet('./afses.json')
    this[$driveCreator] = await pify(multidrive)(
      store,
      DCDN._createAFS,
      DCDN._closeAFS
    )

    // If we are only advertising one DID, join it straight away
    if (this.did) {
      if (this.user) {
        const self = this
        this.afses[this.did] = await pify(this[$driveCreator].create)(this.did)
        this.swarm.on('connection', this.user.handleDCDNConnection)
        this.user.on("match", onMatch)
        this.user.broadcastService('afp:' + this.did)

        async function onMatch(opts) {
          info(`onMatch`)
          await self.user.trackAFS[self.afses[self.did], opts]
          self.join(self.did)
        }
      } else {
        this.swarm.on('connection', (_, peer) => {
          info(`Connected to peer ${peer.host}:${peer.port}`)
        })
        debug(`joining a static DID ${this.did}`)
        this.join(this.did)
      }
    }
  }

  /**
   * Checks if DID exists in initialized AFSes
   *
   * @public
   * @param  {String} did DID to check existance of
   *
   * @return {Boolean} Whether DID exists
   */
  didExists(did) {
    return this.afses && Object.keys(this.afses).indexOf(did) > -1
  }

  /**
   * Stop the DCDN node
   * @public
   * @return {null}
   */
  stop() {
    for (const did of Object.keys(this.afses)) {
      this.swarm.leave(did)
    }
  }

  static async _createAFS(did, done) {
    debug(`initializing afs of ${did}`)
    let afs
    try {
      ({ afs } = await createAFS({ did }))
    } catch (e) {
      error(`Error occurred while creating AFS for ${did}`, e)
      return process.exit(1)
    }

    done(null, afs)
  }

  static async _closeAFS(afs, done) {
    debug('closing afs')
    afs.close()
    done()
  }

  /**
   * Join a discovery swarm described by the passed DID
   * @public
   * @param  {String} did DID to join swarm of
   *
   * @return {null}
   */

  async join(did) {
    if (!this.didExists(did)) {
      this.afses[did] = await pify(this[$driveCreator].create)(did)
    }
    this.swarm.join(did)
    info(`Joined ${did} channel`)
  }

  /**
   * How to handle connection between two peers
   *
   * @private
   *
   * @interface
   *
   * @param  {Object} peer Who we are connecting to
   *
   * @return {Stream}
   */
  stream(peer) {
    let { channel: did } = peer

    did = did || this.did

    // // This function always must return streams, so return an empty one
    if (!did || -1 === Object.keys(this.afses).indexOf(did.toString())) {
      debug('Replicating empty stream')
      return through().setMaxListeners(Infinity)
    }

    info(`Replicating ${did} with download=${this.shouldDownload} upload=${this.shouldUpload}`)
    const stream = this.afses[did].replicate({
      upload: this.shouldUpload,
      download: this.shouldDownload,
    })

    stream.peer = peer

    if (this.shouldDownload) {
      debug(`requesting download of ${did}'s HOME partition`)
      this.afses[did].download('/')
    }

    stream.once('end', () => {
      const action = []
      if (this.shouldUpload) {
        action.push('uploading')
      }

      if (this.shouldDownload) {
        action.push('downloading')
      }

      info(`Finished ${action.join(' + ')}!`)
    })

    return stream
  }
}

module.exports = DCDN
