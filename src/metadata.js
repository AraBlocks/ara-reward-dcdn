/* eslint class-methods-use-this: 1 */
const pump = require('pump')
const EventEmitter = require('events')
const debug = require('debug')('ard:etc')

class MetadataService extends EventEmitter {
  constructor(afs, swarm, opts = {}) {
    super()
    this.afs = afs
    this.partition = afs.partitions.etc
    this.topic = this.partition.discoveryKey
    this.upload = opts.upload || false
    this.download = opts.download || false
    this.swarm = swarm
  }

  async _download() {
    const self = this
    let currentVersion = self.partition.version
    debug('Requesting metadata for: ', this.afs.did)

    this.partition.metadata.on('sync', downloadJson)
    this.once('stop', () => {
      self.partition.metadata.removeListener('sync', downloadJson)
    })

    downloadJson()

    function downloadJson() {
      self.partition.download('metadata.json', () => {
        if (!self.partition.content || currentVersion === self.partition.version) return
        currentVersion = self.partition.version
        debug('Synced metadata version:', currentVersion)

        // Close the peer streams so they know to stop sending
        for (const peer of self.partition.content.peers) {
          peer.end()
        }
      })
    }
  }

  start() {
    if (this.download) this._download()
    if (this.upload) debug('Seeding metadata for: ', this.afs.did, 'version:', this.partition.version)
    this.swarm.join(this.topic, { lookup: this.download, announce: this.upload })
  }

  onConnection(connection) {
    const stream = this.partition.replicate({ upload: this.upload, download: this.download, live: false })

    stream.on('end', () => {
      stream.finalize()
    })

    stream.on('error', (error) => {
      debug(error)
      // TODO: what to do with the connection on replication errors?
    })

    this.once('stop', () => {
      stream.finalize()
    })

    this.partition.metadata.ready((err) => {
      if (err) return
      pump(connection, stream, connection)
    })
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.topic)
    this.emit('stop')
  }
}

module.exports = MetadataService
