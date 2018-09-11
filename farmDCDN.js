const { create: createAFS } = require('ara-filesystem')
const { info, error } = require('ara-console')
const { createSwarm } = require('ara-network/discovery/swarm')
const EventEmitter = require('events')
const multidrive = require('multidrive')
const through = require('through')
const toilet = require('toiletdb')
const debug = require('debug')('ara:afd:farmdcdn')
const pify = require('pify')
const DCDN = require('ara-network-node-dcdn/dcdn')
const $driveCreator = Symbol('driveCreator')
/**
 * @class Creates a DCDN node
 */
class FarmDCDN extends DCDN {
  /**
   * @param {String} opts.did Static DID for syncing
   * @param {Boolean} opts.upload Whether to upload files
   * @param {Boolean} opts.download Whether to download files
   * @return {Object}
   */
  constructor(opts = {}) {
    super(opts)
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
    this.join(this.did)
  }


  /**
   * Join a discovery swarm described by the passed DID
   * @public
   * @param  {String} did DID to join swarm of
   *
   * @return {null}
   */

  async join(did) {
    if (this.user) {
      const self = this
      this.afses[this.did] = await pify(this[$driveCreator].create)(this.did)
      this.swarm.on('connection', this.user.handleDCDNConnection)
      this.user.on("match", onMatch)
      this.user.broadcastService('afp:' + this.did)

      async function onMatch(opts) {
        info(`onMatch`)
        await self.user.trackAFS[self.afses[self.did], opts]
        self.swarm.join(did)
        info(`Joined ${did} channel`)
      }
    } else {
      this.afses[did] = await pify(this[$driveCreator].create)(did)
      this.swarm.join(did)
    }
  }
}

module.exports = FarmDCDN
