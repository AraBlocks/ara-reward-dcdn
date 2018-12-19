const EventEmitter = require('events')
const sinon = require('sinon')
const araFS = require('ara-filesystem')
const test = require('ava')
const fs = require('fs')
const EventEmitter = require('events')
const extend = require('extend')
const {
  TEST_AFS,
  TEST_USER,
  TEST_SWARM,
  TEST_DID
} = require('./_constants')

const TEST_OWNER = '0a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_PASSWORD = 'abcd'
const TEST_SECRET = Buffer.from('secret')
const TEST_DID = '1a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'
const TEST_DID_ETC = '2a98c8305035dcbb1e8fa0826965200269e232e45ac572d26a45db9581986e67'

const TEST_USER = {
  password: TEST_PASSWORD,
  did: TEST_OWNER,
  secretKey: TEST_SECRET
}

const stubbedAFS = {
  afs: {
    ddo: {
      proof: true
    },
    on: () => true,
    version: 1,
    did: TEST_DID,
    key: Buffer.from(TEST_DID, 'hex'),
    discoveryKey: Buffer.from(TEST_DID, 'hex'),
    replicate: () => true,
    close: () => true,
    partitions: {
      home: {
        on: () => true,
        once: () => true,
        removeListener: () => true,
        content: {
          replicate: () => new EventEmitter(),
          on: () => true,
          once: () => true,
          removeListener: () => true,
          length: 10,
          downloaded: () => 10,
        },
        metadata: {
          replicate: () => new EventEmitter(),
        }
      },
      etc: {
        download: (_, cb) => { cb() },
        replicate: () => new EventEmitter(),
        key: Buffer.from(TEST_DID_ETC, 'hex'),
        discoveryKey: Buffer.from(TEST_DID_ETC, 'hex'),
        version: 1,
        metadata: new EventEmitter()
      }
    }
  }
}

const stubbedSwarm = {
  _join: () => true,
  leave: () => true,
  on: () => true,
  destroy: (cb) => { cb() }
}

const sandbox = sinon.createSandbox()

// Stub fs functions because we can't stub toiletdb
sandbox.stub(fs, 'writeFile').callsFake((_, __, cb) => cb(null))
sandbox.stub(fs, 'readFile').callsFake((_, cb) => cb(null, Buffer.from(JSON.stringify([]))))
sandbox.stub(fs, 'stat').callsFake((_, cb) => cb(null))
sandbox.stub(fs, 'rename').callsFake((_, __, cb) => cb(null))
sandbox.stub(fs, 'unlink').callsFake((_, cb) => cb(null))
sandbox.stub(fs, 'unlinkSync').callsFake(() => true)
sandbox.stub(fs, 'mkdir').callsFake((_, __, cb) => cb(null))
// End toiletdb stubs

// TODO: more robust testing. Most of this is just sanity check at the moment.
sandbox.stub(araFS, 'create').resolves(stubbedAFS)

const DCDN = require('../src/dcdn')

test.skip('dcdn.constructor', (t) => {
  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })))

  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })))
})

test('dcdn.join.customOpts', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    metaOnly: true
  })

  const afs = dcdn.getAFS({ did: TEST_DID })

  t.true(afs.dcdn.metaOnly)
  t.true(afs.dcdn.download)
  t.false(afs.dcdn.upload)
})
