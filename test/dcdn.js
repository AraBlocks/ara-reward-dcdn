const test = require('ava')
const sinon = require('sinon')
const DCDN = require('../src/dcdn')
const aid = require('ara-identity')
const afs = require('ara-filesystem')
const context = require('ara-context')()

const rc = require('../src/rc')()

const TEST_PASSWORD = 'abcd'

let testUser = null
let testAfsDid = null

console.log(rc)

test.before(async () => {
    testUser = await aid.create({ context, password: TEST_PASSWORD })
    await aid.util.writeIdentity(testUser)

    const { afs: testAfs } = await afs.create({ owner: testUser.did.identifier, password: TEST_PASSWORD })
    testAfsDid = testAfs.did
    await testAfs.close()
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
    const dcdn = new DCDN({
        userID: testUser.did.identifier,
        password: TEST_PASSWORD
    })

    try {
        await dcdn.unjoin({ did: testAfsDid })
        t.pass()
    } catch (e) {
        t.fail()
    }
})


test('dcdn.join.upload', async (t) => {
    const dcdn = new DCDN({
        userID: testUser.did.identifier,
        password: TEST_PASSWORD
    })



    await dcdn.join({
        did: testAfsDid,
        upload: true,
        download: false,
        price: 1,
        maxPeers: 1
    })

    t.pass()
    await dcdn.stop()
    // t.true(dcdn.running)
    // await dcdn.stop()
    // t.false(dcdn.running)
})

test.todo('dcdn.join.uploadanddownload')
test.todo('dcdn.join.download')
