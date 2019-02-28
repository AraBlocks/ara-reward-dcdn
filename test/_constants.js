const arp = require('ara-reward-protocol')

const {
  Signature
} = arp.messages

// AFS Params
const TEST_DISCOVERY_KEY = '3a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_DID = '1a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_DID_ETC = '2a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_AFS = {
  ddo: {
    proof: true
  },
  once: () => true,
  on: () => true,
  close: () => true,
  version: 1,
  did: TEST_DID,
  HOME: 'home',
  key: Buffer.from(TEST_DID, 'hex'),
  discoveryKey: Buffer.from(TEST_DISCOVERY_KEY, 'hex'),
  partitions: {
    resolve: () => ({ content: null }),
    home: {
      on: () => true,
      once: () => true,
      removeListener: () => true,
      content: {
        replicate: () => true,
        on: () => true,
        once: () => true,
        removeListener: () => true,
        length: 10,
        downloaded: () => 10,
        peers: {
          length: 0
        }
      },
      metadata: {
        ready: (cb) => { cb() },
        replicate: () => ({
          on: () => true,
          once: () => true,
          feed: () => ({
            on: () => true,
            once: () => true,
            extension: () => true,
            close: () => true,
            removeListener: () => true,
          })
        })
      },
      _ensureContent: (cb) => { cb() }
    },
    etc: {
      download: (_, cb) => { cb() },
      key: Buffer.from(TEST_DID_ETC, 'hex'),
      discoveryKey: Buffer.from(TEST_DID_ETC, 'hex'),
      version: 1,
      content: {
        on: () => true,
        replicate: () => true
      },
      metadata: {
        on: () => true,
        once: () => true,
        removeListener: () => true,
        ready: (cb) => { cb() },
        replicate: () => true
      },
      _ensureContent: (cb) => { cb() }
    }
  },
}

// DCDN Params
const TEST_REWARD = '10.0000000000000001'
const TEST_SWARM = {
  _join: () => true,
  leave: () => true,
  on: () => true,
  destroy: (cb) => { cb() }
}

// User params
const TEST_USER_DID = '0a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_USER_PASSWORD = 'password'
const TEST_USER_SECRET = Buffer.from('secret')
const TEST_USER_SIGNATURE = new Signature()
TEST_USER_SIGNATURE.setDid(TEST_USER_DID)
TEST_USER_SIGNATURE.setData('data')
const TEST_USER = {
  did: TEST_USER_DID,
  password: TEST_USER_PASSWORD,
  secretKey: TEST_USER_SECRET,
  verify: () => true,
  sign: () => TEST_USER_SIGNATURE
}

// Peer params
const TEST_PEER_DID = 'abcd'
const TEST_PEER_SIGNATURE = new Signature()
TEST_PEER_SIGNATURE.setDid(TEST_PEER_DID)

module.exports = {
  TEST_AFS,
  TEST_DID,
  TEST_DID_ETC,
  TEST_DISCOVERY_KEY,
  TEST_REWARD,
  TEST_PEER_DID,
  TEST_PEER_SIGNATURE,
  TEST_SWARM,
  TEST_USER_DID,
  TEST_USER,
  TEST_USER_SIGNATURE
}
