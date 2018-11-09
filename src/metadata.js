/* eslint class-methods-use-this: 1 */
const { util: { idify } } = require('ara-farming-protocol')
const createHyperswarm = require('@hyperswarm/network')
const utp = require('utp-native')
const pump = require('pump')
const debug = require('debug')('afd:metadata')

class MetadataService {
  constructor(afs, opts = {}) {
    this.opts = opts
    this.afs = afs
    this.swarm = null
  }

  start() {
    const self = this
    const {
      upload = false,
      download = false
    } = this.opts

    if (!upload && !download) return

    const socket = utp()
    socket.on('error', (error) => {
      debug(error)
      // TODO: what to do with utp errors?
    })

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm({ socket, domain: 'ara.local' })
    this.swarm.on('connection', handleConnection)
    this.swarm.join(this.afs.partitions.etc.discoveryKey, { lookup: download, announce: upload })
    debug('Replicating metadata for: ', this.afs.did)

    function handleConnection(connection, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))
      pump(connection, stream(), connection)
    }

    function stream() {
      return self.afs.partitions.etc.replicate({ upload, download })
    }
  }

  stop() {
    if (this.swarm) this.swarm.leave(this.afs.partitions.etc.discoveryKey)
  }
}

module.exports = MetadataService
