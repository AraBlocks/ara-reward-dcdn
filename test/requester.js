const {
  matchers,
  messages
} = require('ara-farming-protocol')
const { Countdown } = require('../src/util')
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

const user = new User('did', 'pass')

const jobNonce = Buffer.from('did', 'hex')

const stream = { on: () => true }
const afs = { discoveryKey: 'key', replicate: () => stream }

const convertedPrice = Number(expandTokenValue('10'))
const matcher = new matchers.MaxCostMatcher(convertedPrice, 3)
const swarm = {}
const queue = { async push() { return true } }

sinon.stub(Requester.prototype, '_download')

const requesterSignature = new Signature()
sinon.stub(requesterSignature, 'getData').returns('data')
sinon.stub(requesterSignature, 'getDid').returns('id0')
sinon.stub(user, 'sign').returns(requesterSignature)
sinon.stub(user, 'verify').returns(true)

test('requester.validateQuote', async (t) => {
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)
  const quote = new Quote()
  const validation = await requester.validateQuote(quote)
  t.true(validation)
})

test('requester.generateAgreement', async (t) => {
  const quote = new Quote()
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)
  const agreement = await requester.generateAgreement(quote)
  t.true(agreement.getSignature() == requesterSignature && agreement.getQuote() == quote)
})

test('requester.validateAgreement', async (t) => {
  const agreementNonce = Buffer.from('did', 'hex')
  const agreement = new Agreement()
  agreement.setNonce(agreementNonce)
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const validation = await requester.validateAgreement(agreement)
  t.true(validation)
})

test('requester.generateReward', async (t) => {
  const cost = 5
  const units = 5
  const total = units * cost

  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const agreement = new Agreement()
  const quote = new Quote()
  quote.setPerUnitCost(cost)
  agreement.setQuote(quote)

  const reward = requester.generateReward(agreement, units)
  t.true(reward.getSignature() == requesterSignature && total == reward.getAmount() && reward.getAgreement() == agreement)
})

test('requester.dataReceived', async (t) => {
  const id1 = 'id1'
  const id2 = 'id2'
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

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
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  requester.swarm.leave = leaveFake

  requester.stop()
  t.true(leaveFake.calledOnce)
})

test('requester.prepareJob', async (t) => {
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  sinon.stub(rewards, 'getBudget').resolves(5)
  const submitFake = sinon.fake()
  sinon.stub(rewards, 'submit').callsFake(submitFake)
  await requester._prepareJob()

  t.true(submitFake.calledOnce)
})

test('requester.onReceipt', async (t) => {
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  let onCompleteFake = false
  requester.receiptCountdown = new Countdown(1, () => { onCompleteFake = true })
  let connectionFake = false
  const connection = {
    close: () => {
      connectionFake = true
    }
  }
  await requester.onReceipt('receipt', connection)
  t.true(onCompleteFake && connectionFake && 0 == requester.receiptCountdown.count)
})

test('requester.onHireConfirmed', async (t) => {
  const signature = new Signature()
  sinon.stub(signature, 'getData').returns('data')
  sinon.stub(signature, 'getDid').returns('id1')

  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const quote = new Quote()
  quote.setSignature(signature)
  const agreement = new Agreement()
  agreement.setQuote(quote)

  let connectionFake = false
  let pipe = 0
  const peerId = 'id1'
  const connection = {
    peerId,
    stream: {
      pipe: () => {
        pipe += 1
        return {
          pipe: () => {
            pipe += 1
          }
        }
      },
      removeAllListeners: () => {
        connectionFake = true
      }
    }
  }

  await requester.onHireConfirmed(agreement, connection)
  t.true(connectionFake && 2 == pipe)
})

test('requester.sendRewards.valid', async (t) => {
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const deliveryMap = new Map()
  deliveryMap.set('id1', 2)
  deliveryMap.set('id2', 3)
  deliveryMap.set('id3', 0)
  requester.deliveryMap = deliveryMap

  const connectionFake = sinon.fake()
  const closeFake = sinon.fake()
  const connection = {
    sendReward: connectionFake,
    close: closeFake
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
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const connectionFake = sinon.fake()
  const closeFake = sinon.fake()
  const connection = {
    sendReward: connectionFake,
    close: closeFake
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
