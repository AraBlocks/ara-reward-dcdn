const test = require('ava')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const { create: createAFS } = require('ara-filesystem')
const context = require('ara-context')()

const TEST_PASSWORD = 'abcd'

let testUser = null
let testDid = null

// TODO: more robust testing. Most of this is just sanity check at the moment.
test.before(async () => {
  testUser = await aid.create({ context, password: TEST_PASSWORD })
  await aid.save(testUser)
  const { afs } = await createAFS({ owner: testUser.did.identifier, password: TEST_PASSWORD })
  testDid = afs.did
  await afs.close()
})

test.serial('dcdn.constructor', (t) => {
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

test.serial('dcdn.start', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  t.false(Boolean(dcdn.swarm))
  await dcdn.start()
  t.true(Boolean(dcdn.swarm))
  await dcdn.start()
  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
})

test.serial('dcdn.stop', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

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

  t.false(Boolean(dcdn.swarm))
})

test.serial('dcdn.unjoin', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  try {
    await dcdn.unjoin({ did: testDid })
    t.pass()
  } catch (e) {
    t.fail()
  }
})

test.serial('dcdn.join.upload', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did: testDid,
    upload: true,
    download: false,
    price: 1,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: testDid })
})

test.serial('dcdn.join.uploadanddownload', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did: testDid,
    upload: true,
    download: true,
    price: 1,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: testDid })
})

test.serial('dcdn.join.download', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did: testDid,
    upload: false,
    download: true,
    price: 1,
    maxPeers: 1
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: testDid })
})

test.serial('dcdn.join.download.metaOnly', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did: testDid,
    upload: false,
    download: true,
    metaOnly: true
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: testDid })
})

test.serial('dcdn.join.upload.metaOnly', async (t) => {
  const dcdn = new DCDN({
    userID: testUser.did.identifier,
    password: TEST_PASSWORD
  })

  await dcdn.join({
    did: testDid,
    upload: true,
    download: false,
    metaOnly: true
  })

  t.true(Boolean(dcdn.swarm))
  await dcdn.stop()
  t.false(Boolean(dcdn.swarm))
  await dcdn.unjoin({ did: testDid })
})
