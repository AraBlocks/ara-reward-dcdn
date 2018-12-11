const test = require('ava')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const araFS = require('ara-filesystem')
const hyperswarm = require('../src/hyperswarm')
const { rewards, registry, storage } = require('ara-contracts')
const sinon = require('sinon')
const EventEmitter = require('events')
const fs = require('fs')

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
  join: () => true,
  leave: () => true,
  on: () => true,
  destroy: (cb) => { cb() }
}

const sandbox = sinon.createSandbox()

// TODO: more robust testing. Most of this is just sanity check at the moment.
sandbox.stub(hyperswarm, 'create').returns(stubbedSwarm)
sandbox.stub(araFS, 'create').resolves(stubbedAFS)
sandbox.stub(araFS, 'getPrice').resolves('10')
sandbox.stub(registry, 'proxyExists').resolves('true')
sandbox.stub(registry, 'getProxyAddress').resolves('abcd')
sandbox.stub(rewards, 'getBudget').resolves(0)
sandbox.stub(storage, 'read').resolves('abcd')
sandbox.stub(rewards, 'submit').resolves({})
sandbox.stub(rewards, 'allocate').resolves({})
sandbox.stub(aid, 'archive').resolves(true)

// Stub fs functions because we can't stub toiletdb
sandbox.stub(fs, 'writeFile').callsFake((_, __, cb) => cb(null))
sandbox.stub(fs, 'readFile').callsFake((_, cb) => cb(null, Buffer.from(JSON.stringify({}))))
sandbox.stub(fs, 'stat').callsFake((_, cb) => cb(null))
sandbox.stub(fs, 'rename').callsFake((_, __, cb) => cb(null))
sandbox.stub(fs, 'unlink').callsFake((_, cb) => cb(null))
sandbox.stub(fs, 'unlinkSync').callsFake(() => true)
sandbox.stub(fs, 'mkdir').callsFake((_, __, cb) => cb(null))
// End toiletdb stubs

test.serial('dcdn.constructor', (t) => {
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

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN({}) }, Error)

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN() }, Error)
})

test.serial('dcdn.start', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  t.false(Boolean(dcdn.swarm))
  await dcdn.start()
  t.true(Boolean(dcdn.swarm))
  await dcdn.start()
  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.stop', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  t.false(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.start()
  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.join.invalid', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  try {
    await dcdn.join()
    t.fail()
  } catch (e) {
    t.pass()
  }

  try {
    await dcdn.join({})
    t.fail()
  } catch (e) {
    t.pass()
  }

  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.unjoin', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  try {
    await dcdn.unjoin({ did: TEST_DID })
    t.pass()
  } catch (e) {
    t.fail()
  }
})

test.serial('dcdn.join.upload', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.join({
    did: TEST_DID,
    upload: true,
    download: false,
    price: 0,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.join.uploadanddownload', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.join({
    did: TEST_DID,
    upload: true,
    download: true,
    price: 0,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.join.download', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    price: 0,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()

  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: TEST_DID })
})

test.serial('dcdn.join.download.metaOnly', async (t) => {
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

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: TEST_DID })
})

test.serial('dcdn.join.upload.metaOnly', async (t) => {
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.join({
    did: TEST_DID,
    upload: true,
    download: false,
    metaOnly: true
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: TEST_DID })
})
