/* eslint class-methods-use-this: 1 */
const { messages } = require('ara-reward-protocol')
const { readFile } = require('fs')
const { resolve } = require('path')
const crypto = require('ara-crypto')
const pify = require('pify')
const rc = require('ara-runtime-configuration')()
const ss = require('ara-secret-storage')
const debug = require('debug')('ard:util')

class User {
  constructor(did, password) {
    this.did = did
    this.password = password
    this.secretKey = null
  }

  async loadKey() {
    if (!this.did || !this.password) {
      throw new Error('Missing ara identity or password')
    }

    const publicKey = Buffer.from(this.did, 'hex')
    const hash = crypto.blake2b(publicKey).toString('hex')
    const path = resolve(rc.network.identity.root, hash, 'keystore/ara')
    const keystore = JSON.parse(await pify(readFile)(path, 'utf8'))
    const password = crypto.blake2b(Buffer.from(this.password))

    try {
      this.secretKey = ss.decrypt(keystore, { key: password.slice(0, 16) })
    } catch (err) {
      debug(err)
      throw new Error('Password failed to decrypt key')
    }
  }

  sign(message) {
    if (!this.secretKey) {
      debug('secretKey not loaded')
      return null
    }

    let data = null
    try {
      data = crypto.sign(message, this.secretKey)
    } catch (err) {
      data = null
      debug(err)
    }

    const signature = new messages.Signature()
    signature.setDid(this.did)
    signature.setData(data)
    return signature
  }

  verify(message, data) {
    const signedData = Buffer.from(message.getSignature().getData())
    const signedDid = message.getSignature().getDid()
    const publicKey = Buffer.from(signedDid, 'hex')
    return crypto.verify(signedData, data, publicKey)
  }
}

module.exports = User
