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

  function notify(fn, eager) {
    const wait = eager
      ? 5000
      : 50000
    return setTimeout(fn, wait)
  }

  swarm.discovery._notify = notify
  return swarm
}

module.exports = createHyperswarm
