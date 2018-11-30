const network = require('@hyperswarm/network')
const debug = require('debug')('afd:hyperswarm')
const utp = require('utp-native')

function createHyperswarm() {
  const socket = utp()
  socket.on('error', (error) => {
    debug(error)
    // TODO: what to do with utp errors?
  })

  const swarm = network({ socket, domain: 'ara.local' })
  swarm.discovery._notify = notify
  swarm.queue.push = push
  swarm._onpeer = onpeer
  swarm._connectNext = connectNext
  swarm.destroy = destroy
  swarm._bind()

  // Function overrides. Note: ideally we get @hyperswarm/network to incorporate these.

  // Rewrote to shorten wait time
  function notify(fn, eager) {
    const wait = eager
      ? 5000
      : 50000
    // eslint-disable-next-line no-mixed-operators
    return setTimeout(fn, Math.floor(wait + Math.random() * wait))
  }

  // Rewrote to include topic in id (to allow for multiple topics per peer)
  function push(peer) {
    const id = `${peer.host}:${peer.port}@${peer.topic.toString('hex')}`
    if (swarm.queue.seen.has(id)) return
    swarm.queue.seen.set(id, peer)
    if (peer.local) swarm.queue.local.push(peer)
    else swarm.queue.remote.push(peer)
  }

  // Rewrote to synchronize connectNext calls
  function onpeer(peer) {
    swarm.emit('peer', peer)
    swarm.queue.push(peer)
    if (1 === (swarm.queue.remote.length + swarm.queue.local.length)) this._connectNext()
  }

  // Rewrote to synchronize connectNext calls
  function connectNext() {
    const peer = swarm.queue.pop()
    if (!peer) return
    swarm.connect(peer, (err, connection, info) => {
      if (!err) {
        swarm.emit('connection', connection, info)
      } else {
        // debug('connection err:', err, peer)
      }
      swarm._connectNext()
    })
  }

  // Wrote because this doesn't exist yet
  function destroy(callback) {
    swarm.discovery.on('close', onclose)
    swarm.discovery.destroy()

    function onclose() {
      swarm.server.close()
      swarm.socket.close()
      if (callback) callback()
    }
  }

  return swarm
}

module.exports = createHyperswarm
