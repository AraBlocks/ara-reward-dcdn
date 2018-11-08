/* eslint class-methods-use-this: 1 */
const { util: { idify } } = require('ara-farming-protocol')
const createHyperswarm = require('@hyperswarm/network')
const utp = require('utp-native')
const pump = require('pump')
const debug = require('debug')('afd:metadata')

class MetadataService {
  constructor(afs) {
    this.afs = afs
    this.key = afs.partitions.etc.discoveryKey
    this.swarm = null
  }

  start() {
    const self = this

    const socket = utp()
    socket.on('error', (error) => {
      debug(error)
      // TODO: what to do with utp errors?
    })

    // TODO: use single swarm with multiple topics
    this.swarm = createHyperswarm({ socket, domain: 'ara.local' })
    this.swarm.on('connection', handleConnection)
    this.swarm.join(this.key, { lookup: true, announce: true })
    debug('Replicating metadata for: ', this.afs.did)

    function handleConnection(connection, details) {
      const peer = details.peer || {}
      debug('onconnection:', idify(peer.host, peer.port))
      pump(connection, stream(), connection)
    }

    function stream() {
      return self.afs.partitions.etc.replicate()
    }
  }

  stop() {
    this.swarm.leave(this.key)
  }
}

module.exports = MetadataService
