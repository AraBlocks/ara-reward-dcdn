const test = require('ava')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const afs = require('ara-filesystem')
const context = require('ara-context')()

const TEST_PASSWORD = 'abcd'

let testUser = null

test.before(async () => {
  testUser = await aid.create({ context, password: TEST_PASSWORD })
  await aid.util.writeIdentity(testUser)
})

test('dcdn.constructor', (t) => {
  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userID: testUser.did.did,
    password: TEST_PASSWORD
  })))

  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })))

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN({}) }, Error)

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN() }, Error)
})

test('dcdn.start', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  t.false(dcdn.running)
  await dcdn.start()
  t.true(dcdn.running)
  await dcdn.start()
  t.true(dcdn.running)
  await dcdn.stop()
})

test('dcdn.stop', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  t.false(dcdn.running)
  await dcdn.stop()
  t.false(dcdn.running)
  await dcdn.start()
  t.true(dcdn.running)
  await dcdn.stop()
  t.false(dcdn.running)
})

test('dcdn.join.invalid', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

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

  t.false(dcdn.running)
})

test('dcdn.unjoin', async (t) => {
  const { afs: { did } } = await afs.create({ owner: testUser.did.identifier, password: TEST_PASSWORD })

  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  try {
    await dcdn.unjoin({ did })
    t.pass()
  } catch (e) {
    t.fail()
  }
})

test('dcdn.join.upload', async (t) => {
  const { afs: { did } } = await afs.create({ owner: testUser.did.identifier, password: TEST_PASSWORD })

  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did,
    upload: true,
    download: false,
    price: 1,
    maxPeers: 1
  })

  t.true(dcdn.running)
  await dcdn.stop()
  t.false(dcdn.running)
  await dcdn.unjoin({ did })
})

test('dcdn.join.uploadanddownload', async (t) => {
  const { afs: { did } } = await afs.create({ owner: testUser.did.identifier, password: TEST_PASSWORD })

  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did,
    upload: true,
    download: true,
    price: 1,
    maxPeers: 1
  })

  t.true(dcdn.running)
  await dcdn.stop()
  t.false(dcdn.running)
  await dcdn.unjoin({ did })
})

test('dcdn.join.download', async (t) => {
  const { afs: { did } } = await afs.create({ owner: testUser.did.identifier, password: TEST_PASSWORD })

  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did,
    upload: false,
    download: true,
    price: 1,
    maxPeers: 1
  })

  t.true(dcdn.running)
  await dcdn.stop()
  t.false(dcdn.running)
  await dcdn.unjoin({ did })
})

