/* eslint class-methods-use-this: 1 */
const util = require('ara-util')
const { storage, rewards } = require('ara-contracts')
const {
  METADATA_SIGNATURES_INDEX,
  SIGNATURES_WRITE_LENGTH,
  HEADER_LENGTH,
} = require('ara-filesystem/constants')

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
  if (!afs.proxy) return false
  let update
  try {
    const localVersion = afs.version || 0
    const updateVersion = localVersion + 1

    // offset to read from bc to see if update is available
    const offset = HEADER_LENGTH + (updateVersion * SIGNATURES_WRITE_LENGTH)
    const buf = await storage.read({
      fileIndex: METADATA_SIGNATURES_INDEX,
      address: afs.proxy,
      offset
    })

    let downloaded = false
    const feed = afs.partitions.home.content
    if (feed && feed.length) {
      downloaded = (feed.downloaded() >= feed.length)
    }

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

module.exports = {
  isUpdateAvailable,
  isJobOwner,
  Countdown
}
