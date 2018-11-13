/* eslint class-methods-use-this: 1 */
const { util: { idify } } = require('ara-farming-protocol')
const createHyperswarm = require('./hyperswarm')
const pump = require('pump')
const EventEmitter = require('events')
const debug = require('debug')('afd:metadata')

class MetadataService extends EventEmitter {
  constructor(afs, opts = {}) {
    super()
    this.opts = opts
    this.afs = afs
    this.partition = afs.partitions.etc
    this.swarm = null
  }

  start() {
    const self = this
    const {
      upload = false,
      download = false
    } = this.opts

    if (!upload && !download) return
    debug('Current version:', this.partition.version)
    // TODO: Handle if no update available
    this.partition.metadata.once('sync', () => {
      if (download) {
        this.partition.once('sync', () => {
          debug('synced version:', self.partition.version)
          self.emit('complete')
        })
      }
    })

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm()
    this.swarm.on('connection', handleConnection)
    this.swarm.join(this.partition.discoveryKey, { lookup: download, announce: upload })
    debug('Replicating metadata for: ', this.afs.did)

    function handleConnection(connection, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))

      const stream = self.partition.replicate({ upload, download })
      stream.on('error', (error) => {
        debug(error)
        // TODO: what to do with the connection on replication errors?
      })

      self.once('complete', () => {
        stream.destroy()
      })
      pump(connection, stream, connection)
    }
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.partition.discoveryKey)
  }
}

module.exports = MetadataService
