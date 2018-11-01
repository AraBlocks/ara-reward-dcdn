const crypto = require('ara-crypto')
const rc = require('ara-runtime-configuration')()
const { resolve } = require('path')
const { DID } = require('did-uri')
const pify = require('pify')
const { readFile } = require('fs')
const ss = require('ara-secret-storage')


async function sign(user) {
  const did = new DID(user.did)
  const password = crypto.blake2b(Buffer.from(user.pass))
  const publicKey = Buffer.from(did.identifier, 'hex')
  const hash = crypto.blake2b(publicKey).toString('hex')
  const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
  const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))
  const secretKey = ss.decrypt(keystore, { key: password.slice(0, 16) })
  const message = Buffer.from(user.did)
  return crypto.sign(message, secretKey)
}

function verify(signature) {
  const signatureData = Buffer.from(signature.getData())
  const signatureDid = 'did:ara:' + signature.getAraId().getDid()

  const did = new DID(signatureDid)
  const publicKey = Buffer.from(did.identifier, 'hex')
  const message = Buffer.from(signatureDid)

  return crypto.verify(signatureData, message, publicKey)
}

class Countdown {
  constructor(count, onComplete) {
    this.count = count
    this.onComplete = onComplete
  }

  decrement() {
    this.count--
    if (0 === this.count) {
      this.onComplete()
    }
  }
}

module.exports = {
  Countdown,
  sign,
  verify
}
