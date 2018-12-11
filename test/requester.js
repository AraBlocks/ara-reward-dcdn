const {
  matchers,
  messages
} = require('ara-reward-protocol')
const { Requester } = require('../src/requester')
const User = require('../src/user')

const {
  Agreement,
  Quote,
  Signature
} = messages
const { token: { expandTokenValue } } = require('ara-contracts')
const { rewards } = require('ara-contracts')
const sinon = require('sinon')
const test = require('ava')
const EventEmitter = require('events')

const timeout = ms => new Promise(res => setTimeout(res, ms))

const TEST_USER = new User('did', 'pass')
const TEST_JOB_NONCE = Buffer.from('did', 'hex')
const TEST_AFS = {
  discoveryKey: 'key',
  partitions: {
    home: {
      _ensureContent: cb => cb(),
      content: {
        on: () => true,
        replicate: () => true
      }
    }
  }
}

const TEST_PRICE = Number(expandTokenValue('10'))
const TEST_MATCHER = new matchers.MaxCostMatcher(TEST_PRICE, 3)
const TEST_SWARM = {}
const TEST_QUEUE = { async push() { return true } }

const TEST_REQ_SIGNATURE = new Signature()
sinon.stub(TEST_REQ_SIGNATURE, 'getData').returns('data')
sinon.stub(TEST_REQ_SIGNATURE, 'getDid').returns('id0')
sinon.stub(TEST_USER, 'sign').returns(TEST_REQ_SIGNATURE)
sinon.stub(TEST_USER, 'verify').returns(true)

test('requester.waitForContent', async (t) => {
  const afs = {
    readdir: () => '',
    discoveryKey: 'key',
    partitions: {
      home: {
        content: new EventEmitter(),
      }
    }
  }
  afs.partitions.home.content.peers = []

  const sendRewardsFake = sinon.fake()
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })
  sinon.stub(requester, '_sendRewards').callsFake(sendRewardsFake)

  requester._waitForContent()
  afs.partitions.home.content.emit('sync')
  afs.partitions.home.content.emit('sync')
  afs.partitions.home.content.emit('sync')
  afs.partitions.home.content.emit('sync')

  await timeout(1000)
  t.true(1 === sendRewardsFake.callCount)
})

test('requester.validateQuote', async (t) => {
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })
  const quote = new Quote()
  const validation = await requester.validateQuote(quote)
  t.true(validation)
})

test('requester.generateAgreement', async (t) => {
  const quote = new Quote()
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })
  const agreement = await requester.generateAgreement(quote)
  t.true(agreement.getSignature() == TEST_REQ_SIGNATURE && agreement.getQuote() == quote)
})

test('requester.validateAgreement', async (t) => {
  const agreementNonce = Buffer.from('did', 'hex')
  const agreement = new Agreement()
  agreement.setNonce(agreementNonce)
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const validation = await requester.validateAgreement(agreement)
  t.true(validation)
})

test('requester.generateReward', async (t) => {
  const cost = 5
  const units = 5
  const total = units * cost

  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const agreement = new Agreement()
  const quote = new Quote()
  quote.setPerUnitCost(cost)
  agreement.setQuote(quote)

  const reward = requester.generateReward(agreement, units)
  t.true(reward.getSignature() == TEST_REQ_SIGNATURE && total == reward.getAmount() && reward.getAgreement() == agreement)
})

test('requester.dataReceived', async (t) => {
  const id1 = 'id1'
  const id2 = 'id2'
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const deliveryMap = new Map()
  deliveryMap.set(id1, 5)
  requester.deliveryMap = deliveryMap
  requester._dataReceived(id1, 5)
  requester._dataReceived(id2, 5)

  const data = requester.deliveryMap
  t.true(10 == data.get(id1) && 5 == data.get(id2))
})

test('requester.stop', async (t) => {
  const leaveFake = sinon.fake()
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  requester.swarm.leave = leaveFake

  requester.stop()
  t.true(leaveFake.calledOnce)
})

test('requester.prepareJob', async (t) => {
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  sinon.stub(rewards, 'getBudget').resolves(5)
  const submitFake = sinon.fake()
  sinon.stub(rewards, 'submit').callsFake(submitFake)
  await requester._prepareJob()

  t.true(submitFake.calledOnce)
})

test('requester.onHireConfirmed', async (t) => {
  const replicateFake = sinon.fake()
  const afs = {
    discoveryKey: 'key',
    partitions: {
      home: {
        _ensureContent: cb => cb(),
        content: {
          on: () => true,
          replicate: replicateFake
        }
      }
    }
  }

  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const farmerId = 'id1'
  const signature = new Signature()
  sinon.stub(signature, 'getData').returns('data')
  sinon.stub(signature, 'getDid').returns(farmerId)
  const quote = new Quote()
  quote.setSignature(signature)
  const agreement = new Agreement()
  agreement.setQuote(quote)

  const connection = {
    peerId: farmerId,
    stream: {
      destroyed: false
    }
  }

  await requester.onHireConfirmed(agreement, connection)
  t.true(requester.hiredFarmers.has(farmerId))
})

test('requester.sendRewards.valid', async (t) => {
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const deliveryMap = new Map()
  deliveryMap.set('id1', 2)
  deliveryMap.set('id2', 3)
  deliveryMap.set('id3', 0)
  requester.deliveryMap = deliveryMap

  const connectionFake = sinon.fake()
  const closeFake = sinon.fake()
  const connection = {
    once: () => true,
    sendReward: connectionFake,
    close: closeFake,
    stream: {
      on: () => true,
      resume: () => true
    },
    onData: {
      bind: () => true
    }
  }

  const agreement1 = generateAgreement('id1', 2000)
  const agreement2 = generateAgreement('id2', 4000)
  const agreement3 = generateAgreement('id3', 6000)
  const agreement4 = generateAgreement('id4', 4000)

  const hiredFarmersMap = new Map()
  hiredFarmersMap.set('id1', { connection, agreement: agreement1 })
  hiredFarmersMap.set('id2', { connection, agreement: agreement2 })
  hiredFarmersMap.set('id3', { connection, agreement: agreement3 })
  hiredFarmersMap.set('id4', { connection, agreement: agreement4 })
  requester.hiredFarmers = hiredFarmersMap

  await requester._sendRewards()

  t.true(2 === connectionFake.callCount)
  t.true(2 === closeFake.callCount)
})

test('requester.sendRewards.none', async (t) => {
  const requester = new Requester({
    jobId: TEST_JOB_NONCE,
    matcher: TEST_MATCHER,
    user: TEST_USER,
    afs: TEST_AFS,
    swarm: TEST_SWARM,
    queue: TEST_QUEUE
  })

  const connectionFake = sinon.fake()
  const closeFake = sinon.fake()
  const connection = {
    sendReward: connectionFake,
    close: closeFake,
    once: () => true
  }

  const agreement1 = generateAgreement('id1', 2000)
  const agreement2 = generateAgreement('id2', 4000)
  const agreement3 = generateAgreement('id3', 6000)
  const agreement4 = generateAgreement('id4', 4000)

  const hiredFarmersMap = new Map()
  hiredFarmersMap.set('id1', { connection, agreement: agreement1 })
  hiredFarmersMap.set('id2', { connection, agreement: agreement2 })
  hiredFarmersMap.set('id3', { connection, agreement: agreement3 })
  hiredFarmersMap.set('id4', { connection, agreement: agreement4 })
  requester.hiredFarmers = hiredFarmersMap

  await requester._sendRewards()

  t.true(connectionFake.notCalled)
  t.true(4 === closeFake.callCount)
})

function generateAgreement(did, price) {
  const signature = new Signature()
  signature.setDid(did)
  const quote = new Quote()
  quote.setSignature(signature)
  quote.setPerUnitCost(price)
  const agreement = new Agreement()
  agreement.setQuote(quote)

  return agreement
}
