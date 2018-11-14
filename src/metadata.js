/* eslint class-methods-use-this: 1 */
const pump = require('pump')
const EventEmitter = require('events')
const debug = require('debug')('afd:metadata')

class MetadataService extends EventEmitter {
  constructor(afs, swarm, opts = {}) {
    super()
    this.afs = afs
    this.partition = afs.partitions.etc
    this.topic = this.partition.discoveryKey
    this.upload = opts.upload || false
    this.download = opts.download || false
    this.swarm = swarm

    this._attachListeners()
  }

  _attachListeners() {
    const self = this
    debug('Current version:', this.partition.version)
    // TODO: Handle if no update available
    this.partition.metadata.once('sync', () => {
      if (self.download) {
        self.partition.once('sync', () => {
          debug('synced version:', self.partition.version)
          self.emit('complete')
        })
      }
    })
  }

  start() {
    this.swarm.join(this.topic, { lookup: this.download, announce: this.upload })
    debug('Replicating metadata for: ', this.afs.did)
  }

  onConnection(connection) {
    const stream = this.partition.replicate({ upload: this.upload, download: this.download })
    stream.on('error', (error) => {
      debug(error)
      // TODO: what to do with the connection on replication errors?
    })

    this.once('complete', () => {
      stream.destroy()
    })

    pump(connection, stream, connection)
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
  }
}

module.exports = MetadataService
