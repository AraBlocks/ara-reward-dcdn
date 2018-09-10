const { createChannel } = require('ara-network/discovery')
const { info, error } = require('ara-console')
const { Handshake } = require('ara-network/handshake')
const { readFile } = require('fs')
const { keyRing } = require('ara-network/keys')
const { resolve } = require('path')
const { unpack } = require('ara-network/keys')
const inquirer = require('inquirer')
const { DID } = require('did-uri')
const crypto = require('ara-crypto')
const debug = require('debug')('ara:dcdn:subnet')
const pify = require('pify')
const pump = require('pump')
const net = require('net')
const rc = require('ara-network/rc')()
const ss = require('ara-secret-storage')

require('ara-identity/rc')()

/**
 * Transmits DID's existance to other's holding specified network keys
 *
 * @param  {String} did DID to publish
 * @param  {Object} opts Options used for the handshake
 * @return {null}
 */
async function publishDID(did, opts) {
  try {
    const writer = await _createSecureWriter(opts)
    info(`Publishing ${did} is available for download`)
    writer.write(Buffer.from(did, 'hex'))
  } catch (e) {
    error(`Error occurred while creating secure writer for ${did}`, e)
    return process.exit(1)
  }
}

/**
 * Listen for others to transmit new DIDs on network keys passed
 *
 * @param  {Object} opts Options used for the handshake
 * @param  {Function} callback Function to pass found DID to
 * @return {null}
 */
async function listenForDIDs(opts, callback) {
  const channel = createChannel()

  debug('make identity from ', opts.identity)
  const did = new DID(opts.identity)
  const publicKey = Buffer.from(did.identifier, 'hex')

  let { password } = await inquirer.prompt([ {
    type: 'password',
    name: 'password',
    message:
    'Please enter your identity\'s passphrase\n' +
    'Passphrase:'
  } ])

  password = crypto.blake2b(Buffer.from(password))

  const hash = crypto.blake2b(publicKey).toString('hex')
  const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
  const secret = Buffer.from(opts.secret)

  const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))

  const secretKey = crypto.decrypt(keystore, { key: password.slice(0, 16) })

  const keyring = keyRing(opts.keys, { secret })

  let buffer
  try {
    buffer = await keyring.get(opts.name)
  } catch (e) {
    error(`Error occurred while retrieving ${opts.name} from keyring ${opts.keys}`, e)
    return process.exit(1)
  }

  const unpacked = unpack({ buffer })
  const { discoveryKey } = unpacked
  const server = net.createServer(onconnection)
    .on('error', (e) => {
      error('Error inside of server listening for DID connections', e)
      return process.exit(1)
    })

  info(`Listening on port ${opts.port || 5000} for DID announcements`)
  server.listen(opts.port || 5000, onlisten)

  function onlisten(err) {
    if (err) { throw err }
    const { port } = server.address()
    channel.join(discoveryKey, port)
  }

  function onconnection(socket) {
    debug('got a connection!')
    const handshake = new Handshake({
      publicKey,
      secretKey,
      secret,
      remote: { publicKey: unpacked.publicKey },
      domain: { publicKey: unpacked.domain.publicKey }
    })

    debug('saying hello')
    handshake.hello()
    handshake.on('hello', onhello)
    handshake.on('okay', onokay)

    pump(handshake, socket, handshake, (err) => {
      if (err) {
        error(err)
        return process.exit(1)
      } else {
        info('connection closed')
      }
    })

    function onhello() {
      debug('hello!')
      handshake.auth()
    }

    function onokay() {
      debug('okay!')
      const reader = handshake.createReadStream()

      reader.resume()
      reader.on('data', (data) => {
        const newDid = data.toString('hex')
        info(`Found published DID ${newDid}`)
        return callback(newDid)
      })
    }
  }
}

async function _createSecureWriter(opts) {
  return new Promise(async (_resolve, _reject) => {
    try {
      const channel = createChannel()
      const parsedDID = new DID(opts.identity)
      const publicKey = Buffer.from(parsedDID.identifier, 'hex')

      password = crypto.blake2b(Buffer.from(opts.password))

      const hash = crypto.blake2b(publicKey).toString('hex')
      const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
      const secret = Buffer.from(opts.secret)
      const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))
      const secretKey = ss.decrypt(keystore, { key: password.slice(0, 16) })

      const keyring = keyRing(opts.keys, { secret: secretKey })
      const buffer = await keyring.get(opts.name)
      const unpacked = unpack({ buffer })
      const { discoveryKey } = unpacked

      channel.join(discoveryKey)
      channel.on('peer', onpeer)

      function onpeer(chan, peer) {
        debug(`got peer: ${peer.host}:${peer.port}`)
        const socket = net.connect(peer.port, peer.host)
        const handshake = new Handshake({
          publicKey,
          secretKey,
          secret,
          remote: { publicKey: unpacked.publicKey },
          domain: { publicKey: unpacked.domain.publicKey }
        })

        pump(handshake, socket, handshake)

        handshake.on('hello', onhello)
        handshake.on('okay', onokay)

        function onhello() {
          debug('hello!')
          handshake.hello()
        }

        function onokay() {
          debug('resolving writer')
          return _resolve(handshake.createWriteStream())
        }
      }
    } catch (e) {
      return _reject(e)
    }
  })
}

module.exports = {
  publishDID,
  listenForDIDs,
}
