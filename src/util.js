/* eslint class-methods-use-this: 1 */
const util = require('ara-util')
const { storage, rewards } = require('ara-contracts')
const {
  METADATA_SIGNATURES_INDEX,
  SIGNATURES_WRITE_LENGTH,
  HEADER_LENGTH,
} = require('ara-filesystem/constants')
const { Ed25519VerificationKey2018 } = require('ld-cryptosuite-registry')
const { DID } = require('did-uri')
const crypto = require('ara-crypto')
const { DIDDocument } = require('did-document')

const OWNER = 'owner'

class Countdown {
  constructor(count, onComplete) {
    this.count = count
    this.onComplete = onComplete
    this.started = false
    this.fired = false
  }

  start() {
    this.started = true
    this._checkComplete()
  }

  decrement() {
    this.count--
    this._checkComplete()
  }

  increment() {
    this.count++
  }

  _checkComplete() {
    if (!this.fired && this.started && 0 >= this.count) {
      this.onComplete()
    }
  }
}

// TODO: migrate to ara-filesystem to be an interal function of an afs
async function isUpdateAvailable(afs) {
  console.log("PROXY:", afs)
  if (!afs.proxy) return false
  let update
  try {
    const localVersion = afs.version || 0
    const updateVersion = localVersion + 1

    console.log("LOCAL:", localVersion)
    // offset to read from bc to see if update is available
    const offset = HEADER_LENGTH + (updateVersion * SIGNATURES_WRITE_LENGTH)
    const buf = await storage.read({
      fileIndex: METADATA_SIGNATURES_INDEX,
      address: afs.proxy,
      offset
    })

    let downloaded = false
    const feed = afs.partitions.home.content
    console.log("FEED:", feed)
    if (feed && feed.length) {
      downloaded = (feed.downloaded() >= feed.length)
    }

    console.log("BUF:", buf)
    update = !downloaded || (null !== buf)
  } catch (err) {
    throw err
  }

  return update
}

async function isJobOwner(opts) {
  const {
    owner
  } = opts

  const queryAddress = await util.getAddressFromDID(owner)
  const responseAddress = await rewards.getJobOwner(opts)

  return queryAddress.toUpperCase() === responseAddress.toUpperCase()
}

// Note: Modified from ara-identity-resolver. Consider adding to ara-identity or ara-util
/**
 * Verifies the integrity of a DDO.
 * @private
 * @param {Object} ddo
 * @return {Boolean}
 */
function verify(obj) {
  const ddo = new DIDDocument(obj)

  const proof = ddo.proof()
  const owner = ddo.id
  const creator = new DID(proof.creator)

  if (!proof || !proof.type || !proof.signatureValue) {
    return false
  }

  if (OWNER !== creator.fragment) {
    return false
  }

  if (creator.did !== owner.did) {
    return false
  }

  if (Ed25519VerificationKey2018 !== proof.type) {
    return false
  }

  let publicKey = null
  for (const { id, publicKeyHex } of ddo.publicKey) {
    if (id && publicKeyHex) {
      const did = new DID(id)
      if (OWNER === did.fragment && did.did === owner.did) {
        publicKey = Buffer.from(publicKeyHex, 'hex')
      }
    }
  }

  if (!publicKey) {
    return false
  }

  const signature = Buffer.from(proof.signatureValue, 'hex')
  const digest = ddo.digest(crypto.blake2b)
  return crypto.ed25519.verify(signature, digest, publicKey)
}

module.exports = {
  isUpdateAvailable,
  isJobOwner,
  Countdown,
  verify
}
