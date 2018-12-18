const test = require('ava')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const araFS = require('ara-filesystem')
const hyperswarm = require('../src/hyperswarm')
const { rewards, registry, storage } = require('ara-contracts')
const sinon = require('sinon')
const EventEmitter = require('events')
const ardUtil = require('../src/util')
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

const TEST_AFS = {
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

const TEST_SWARM = {
  _join: () => true,
  leave: () => true,
  on: () => true,
  destroy: (cb) => { cb() }
}

sinon.stub(registry, 'proxyExists').resolves('true')
sinon.stub(aid, 'archive').resolves(true)

// Stub fs functions because we can't stub toiletdb
sinon.stub(fs, 'writeFile').callsFake((_, __, cb) => cb(null))
sinon.stub(fs, 'readFile').callsFake((_, cb) => cb(null, Buffer.from(JSON.stringify({}))))
sinon.stub(fs, 'stat').callsFake((_, cb) => cb(null))
sinon.stub(fs, 'rename').callsFake((_, __, cb) => cb(null))
sinon.stub(fs, 'unlink').callsFake((_, cb) => cb(null))
sinon.stub(fs, 'unlinkSync').callsFake(() => true)
sinon.stub(fs, 'mkdir').callsFake((_, __, cb) => cb(null))
// End toiletdb stubs

function createSandbox(opts = {}) {
  const sandbox = sinon.createSandbox()
  sandbox.stub(hyperswarm, 'create').returns(('swarm' in opts) ? opts.swarm : TEST_SWARM)
  sandbox.stub(araFS, 'create').resolves(('afs' in opts) ? opts.afs : TEST_AFS)
  sandbox.stub(araFS, 'getPrice').resolves(('price' in opts) ? opts.price : '10')
  sandbox.stub(registry, 'getProxyAddress').resolves(('proxy' in opts) ? opts.proxy : 'abcd')
  sandbox.stub(rewards, 'getBudget').resolves(('budget' in opts) ? opts.budget : 0)
  sandbox.stub(storage, 'read').resolves(('read' in opts) ? opts.read : 'abcd')
  sandbox.stub(rewards, 'submit').resolves(('submit' in opts) ? opts.submit : {})
  sandbox.stub(rewards, 'allocate').resolves(('allocate' in opts) ? opts.allocate : {})
  sandbox.stub(ardUtil, 'verify').resolves(('verify' in opts) ? opts.verify : true)
  return sandbox
}

test.serial('dcdn.constructor', (t) => {
  const sandbox = createSandbox()

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

  sandbox.restore()
})

test.serial('dcdn.start', async (t) => {
  const sandbox = createSandbox()

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

  sandbox.restore()
})

test.serial('dcdn.stop', async (t) => {
  const sandbox = createSandbox()

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

  sandbox.restore()
})

test.serial('dcdn.join.invalid', async (t) => {
  const sandbox = createSandbox()

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

  sandbox.restore()
})

test.serial('dcdn.unjoin', async (t) => {
  const sandbox = createSandbox()

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

  sandbox.restore()
})

test.serial('dcdn.join.upload', async (t) => {
  const sandbox = createSandbox()

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
  t.true(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  t.false(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.uploadanddownload', async (t) => {
  const sandbox = createSandbox()

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
  t.true(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  t.false(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.download', async (t) => {
  const sandbox = createSandbox()

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
  t.true(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  t.false(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.download.metaOnly', async (t) => {
  const sandbox = createSandbox()

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
  t.true(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  t.false(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.upload.metaOnly', async (t) => {
  const sandbox = createSandbox()

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
  t.true(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  t.false(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.noproxy', async (t) => {
  const sandbox = createSandbox({
    proxy: null
  })

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  try {
    await dcdn.join({
      did: TEST_DID,
      upload: false,
      download: true,
      price: 0,
      maxPeers: 1
    })
    t.fail()
  } catch (e) {
    t.pass()
  }

  sandbox.restore()
})

test.serial('dcdn.join.unverified', async (t) => {
  const sandbox = createSandbox({
    verify: false
  })

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  try {
    await dcdn.join({
      did: TEST_DID,
      upload: false,
      download: true,
      price: 0,
      maxPeers: 1
    })
    t.fail()
  } catch (e) {
    t.pass()
  }

  sandbox.restore()
})