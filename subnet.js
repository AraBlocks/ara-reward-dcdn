const { decrypt, unpack } = require('ara-network/keys')
const { createChannel } = require('ara-network/discovery')
const { info, warn } = require('ara-console')
const { Handshake } = require('ara-network/handshake')
const { readFile } = require('fs')
const { keyRing } = require('ara-network/keys')
const { resolve } = require('path')
const inquirer = require('inquirer')
const secrets = require('ara-network/secrets')
const storage = require('ara-secret-storage')
const { DID } = require('did-uri')
const crypto = require('ara-crypto')
const debug = require('debug')('ara:dcdn:subnet')
const pify = require('pify')
const pump = require('pump')
const net = require('net')
const rc = require('ara-network/rc')()

require('ara-identity/rc')()

async function publishDID(did, opts) {
  const writer = await _createSecureWriter(opts)

  writer.write(Buffer.from(did, 'hex'))
  writer.close()
}

async function listenForDIDs(conf, callback) {
  const channel = createChannel()

  debug('make identity from ', conf.identity)
  const did = new DID(conf.identity)
  const publicKey = Buffer.from(did.identifier, 'hex')

  let { password } = await inquirer.prompt([ {
    type: 'password',
    name: 'password',
    message:
    'Please enter the passphrase associated with the node identity.\n' +
    'Passphrase:'
  } ])

  password = crypto.blake2b(Buffer.from(password))

  const hash = crypto.blake2b(publicKey).toString('hex')
  const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
  const secret = Buffer.from(conf.secret)
  const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))

  const secretKey = crypto.decrypt(keystore, { key: password.slice(0, 16) })

  const contents = await pify(readFile)(conf.keys)

  const keyring = keyRing(conf.keys, { secret })

  const buffer = await keyring.get(conf.name)
  const unpacked = unpack({ buffer })
  const { discoveryKey } = unpacked
  const server = net.createServer(onconnection)

  console.log(`listening on port ${conf.port || 5000} for DID announcements`)
  server.listen(conf.port || 5000, onlisten)

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
        warn(err.message)
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
        const did = data.toString('hex')
        return callback(did)
      })
    }
  }
}

async function _createSecureWriter(conf) {
  return new Promise(async (_resolve, _reject) => {
    const channel = createChannel()

    let { password } = await inquirer.prompt([ {
      type: 'password',
      name: 'password',
      message:
      'Please enter the passphrase associated with the node identity.\n' +
      'Passphrase:'
    } ])

    const did = new DID(conf.identity)
    const publicKey = Buffer.from(did.identifier, 'hex')

    password = crypto.blake2b(Buffer.from(password))

    const hash = crypto.blake2b(publicKey).toString('hex')
    console.log("HASH:", hash, rc.network.identity)
    const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
    console.log("PATH:", path)
    const secret = Buffer.from(conf.secret)
    const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))

    const secretKey = crypto.decrypt(keystore, { key: password.slice(0, 16) })

    const contents = await pify(readFile)(conf.keys)

    const keyring = keyRing(conf.keys, { secret: secretKey })

    const buffer = await keyring.get(conf.name)
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
  })
}

module.exports = {
  publishDID,
  listenForDIDs,
}
