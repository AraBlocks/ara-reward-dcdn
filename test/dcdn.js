const test = require('ava')

const { rewards, registry, storage } = require('ara-contracts')
const EventEmitter = require('events')
const hyperswarm = require('../src/hyperswarm')
const ardUtil = require('../src/util')
const extend = require('extend')
const araFS = require('ara-filesystem')
const sinon = require('sinon')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const fs = require('fs')
const {
  TEST_AFS,
  TEST_USER,
  TEST_SWARM,
  TEST_DID
} = require('./_constants')

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
  sandbox.stub(araFS, 'create').resolves({ afs: ('afs' in opts) ? opts.afs : TEST_AFS })
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

test.serial('dcdn.emit', async (t) => {
  const sandbox = createSandbox()

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })

  // Call debug
  dcdn._info('message')
  dcdn._warn('message')

  // Call emit
  const infoFake = sinon.fake()
  const warnFake = sinon.fake()
  dcdn.on('info', infoFake)
  dcdn.on('warn', warnFake)
  dcdn._info('message')
  dcdn._warn('message')

  t.true(infoFake.calledOnce)
  t.true(warnFake.calledOnce)

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

test.serial('dcdn.dryRunJoin.invalid', async (t) => {
  const sandbox = createSandbox()

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  try {
    await dcdn.dryRunJoin({
      did: 'adf123adf123adf123adf123adf123adf123adf123adf123adf123adf123ad235'
    })
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

test.serial('dcdn.unjoin.badafs', async (t) => {
  const emitFake = sinon.fake()

  const afs = extend(true, {}, TEST_AFS, {
    close: () => {
      throw new Error()
    }
  })

  const sandbox = createSandbox({
    afs
  })

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER
  sinon.stub(dcdn, '_warn').callsFake(emitFake)

  await dcdn.join({
    did: TEST_DID,
    upload: true,
    download: false,
    price: 0,
    maxPeers: 1
  })

  try {
    await dcdn.unjoin({ did: TEST_DID })
    t.true(emitFake.calledOnce)
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

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.startandupload', async (t) => {
  const sandbox = createSandbox()

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER

  await dcdn.start()
  await dcdn.join({
    did: TEST_DID,
    upload: true,
    download: false,
    price: 0,
    maxPeers: 1
  })
  t.true(Boolean(dcdn.swarm))
  t.true(TEST_DID in dcdn.topics)

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
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

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.download', async (t) => {
  const afs = extend(true, {}, TEST_AFS, {
    partitions: {
      home: {
        content: extend(true, TEST_AFS.partitions.home.content, new EventEmitter())
      }
    }
  })

  const sandbox = createSandbox({ afs })

  const emitFake = sinon.fake()
  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER
  sinon.stub(dcdn, 'emit').callsFake(emitFake)

  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    price: 0,
    maxPeers: 1
  })
  t.true(Boolean(dcdn.swarm))
  t.true(TEST_DID in dcdn.topics)

  // Test download progress
  afs.partitions.home.content.emit('download', {}, { length: 1 }, {
    stream: {
      stream: {
        peerId: 'abcd'
      }
    }
  })
  t.true(emitFake.calledWith('download-progress'))

  // Test peer-update
  afs.partitions.home.content.peers.length = 1
  afs.partitions.home.content.emit('peer-add')
  t.true(emitFake.calledWith('peer-update', TEST_DID, 1))

  // Test peer-update
  afs.partitions.home.content.peers.length = 0
  afs.partitions.home.content.emit('peer-remove')
  t.true(emitFake.calledWith('peer-update', TEST_DID, 0))

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))

  sandbox.restore()
})

test.serial('dcdn.join.stopstart', async (t) => {
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
  t.false(TEST_DID in dcdn.topics)
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

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
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

  await dcdn.unjoin({ did: TEST_DID })
  t.false(TEST_DID in dcdn.topics)

  await dcdn.stop()
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
  const warnSpy = sinon.spy(dcdn, '_warn')

  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    price: 0,
    maxPeers: 1
  })

  t.true(warnSpy.calledOnce)

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
  const warnSpy = sinon.spy(dcdn, '_warn')

  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    price: 0,
    maxPeers: 1
  })

  t.true(warnSpy.calledOnce)

  sandbox.restore()
})

test.serial('dcdn.startandjoin.unverified', async (t) => {
  const sandbox = createSandbox({
    verify: false
  })

  const dcdn = new DCDN({
    userId: TEST_USER.did,
    password: TEST_USER.password
  })
  dcdn.user = TEST_USER
  const warnSpy = sinon.spy(dcdn, '_warn')

  await dcdn.start()
  await dcdn.join({
    did: TEST_DID,
    upload: false,
    download: true,
    price: 0,
    maxPeers: 1
  })

  t.true(warnSpy.calledOnce)

  sandbox.restore()
})
