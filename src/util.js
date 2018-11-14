/* eslint class-methods-use-this: 1 */
const { messages } = require('ara-farming-protocol')
const { readFile } = require('fs')
const { resolve } = require('path')
const crypto = require('ara-crypto')
const pify = require('pify')
const rc = require('ara-runtime-configuration')()
const ss = require('ara-secret-storage')
const debug = require('debug')('afd:util')

class User {
  constructor(did, password) {
    this.did = did
    this.password = password
    this.secretKey = null
  }

  async loadKey() {
    if (!this.did || !this.password) {
      debug('user did or password not found')
      return
    }
    const password = crypto.blake2b(Buffer.from(this.password))
    const publicKey = Buffer.from(this.did, 'hex')
    const hash = crypto.blake2b(publicKey).toString('hex')
    const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
    const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))
    this.secretKey = ss.decrypt(keystore, { key: password.slice(0, 16) })
  }

  sign(message) {
    if (!this.secretKey) {
      debug('secretKey not loaded')
      return null
    }
    const signature = crypto.sign(message, this.secretKey)
    const userSig = new messages.Signature()
    userSig.setDid(this.did)
    userSig.setData(signature)
    return userSig
  }

  verify(message, data) {
    const signedData = Buffer.from(message.getSignature().getData())
    const signedDid = message.getSignature().getDid()
    const publicKey = Buffer.from(signedDid, 'hex')
    return crypto.verify(signedData, data, publicKey)
  }
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
  User
}
