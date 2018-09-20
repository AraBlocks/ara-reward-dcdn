let { keypath, networkSecret, networkKeyName } = require('./rc.js')
const { unpack, keyRing, derive } = require('ara-network/keys')
const { info, warn } = require('ara-console')
const { Handshake } = require('ara-network/handshake')
const { readFile } = require('fs')
const { resolve } = require('path')
const { DID } = require('did-uri')
const crypto = require('ara-crypto')
const pify = require('pify')
const ss = require('ara-secret-storage')
const rc = require('ara-runtime-configuration')()


function configFarmerHandshake(handshake) {
  handshake.hello()
  handshake.on('hello', onhello)

  function onhello() {
    info('got HELLO')
    handshake.auth()
  }
  return handshake
}

function configRequesterHandshake(handshake) {
  handshake.on('hello', onhello)

  function onhello() {
    info('got HELLO')
    handshake.hello()
  }

  return handshake
}

async function getHandshake(conf) {
  const { secret, unpacked, kp
  } = await unpackKeys(conf)
  const handshake = new Handshake({
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    secret,
    remote: { publicKey: unpacked.publicKey },
    domain: { publicKey: unpacked.domain.publicKey }
  })

  handshake.on('auth', onauth)
  handshake.on('okay', onokay)

  function onauth() {
    info('got AUTH')
  }

  function onokay(signature) {
    info('got OKAY')
    handshake.emit('handshake', signature)
  }
  return handshake
}

async function unpackKeys(conf) {
  if (conf.networkSecret) {
    networkSecret = conf.networkSecret
  }

  if (conf.networkKeyName) {
    networkKeyName = conf.networkKeyName
  }

  if (conf.keypath) {
    keypath = conf.keypath
  }

  let id = conf.identity
  if (conf.identity && 0 !== conf.identity.indexOf('did:ara:')) {
    id = `did:ara:${conf.identity}`
  }
  const did = new DID(id)
  const publicKey = Buffer.from(did.identifier, 'hex')
  const password = crypto.blake2b(Buffer.from(conf.passphrase))
  const hash = crypto.blake2b(publicKey).toString('hex')
  const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
  const secret = Buffer.from(networkSecret)
  const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))
  const secretKey = ss.decrypt(keystore, { key: password.slice(0, 16) })
  const keyring = keypath.indexOf('pub') < 0 ? keyRing(keypath, { secret: secretKey }) : keyRing(keypath, { secret })

  if (await keyring.has(networkKeyName)) {
    const buffer = await keyring.get(networkKeyName)
    const unpacked = unpack({ buffer })
    const kp = derive({ secretKey, name: networkKeyName })
    return {
      secret, unpacked, kp
    }
  }
  warn(`No key for network "${networkKeyName}". Data will be unencrypted.`)

  return null
}

module.exports = {
  getHandshake,
  configFarmerHandshake,
  configRequesterHandshake
}
