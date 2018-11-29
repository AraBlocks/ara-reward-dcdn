const {
  matchers,
  messages
} = require('ara-farming-protocol')
const { User, Countdown } = require('../src/util')
const { Requester } = require('../src/requester')

const {
  Agreement,
  Reward,
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

const signature = new Signature()
sinon.stub(user, 'sign').returns(signature)
sinon.stub(user, 'verify').returns(true)
sinon.stub(signature, 'getData').returns('data')
sinon.stub(signature, 'getDid').returns('id1')

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
  t.true(agreement.getSignature() == signature && agreement.getQuote() == quote)
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
  const peerId = 'id'
  const units = 5
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const agreement = new Agreement()
  const quote = new Quote()
  quote.setPerUnitCost(5)
  agreement.setQuote(quote)
  requester.hiredFarmers.set(peerId, { agreement })

  const reward = requester.generateReward(peerId, units)
  t.true(reward.getSignature() == signature && 25 == reward.getAmount() && reward.getAgreement() == agreement)
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

test('requester.sendRewards', async (t) => {
  const requester = new Requester(jobNonce, matcher, user, afs, swarm, queue)

  const deliveryMap = new Map()
  deliveryMap.set('id1', 5)
  requester.deliveryMap = deliveryMap

  let connectionFake = false
  const connection = {
    sendReward: () => {
      connectionFake = true
    }
  }
  const hiredFarmersMap = new Map()
  hiredFarmersMap.set('id1', { connection })
  requester.hiredFarmers = hiredFarmersMap

  const quote = new Quote()
  quote.setSignature(signature)
  const agreement = new Agreement()
  agreement.setQuote(quote)
  const reward = new Reward()
  reward.setAgreement(agreement)
  reward.setAmount(10)

  sinon.stub(requester, 'generateReward').returns(reward)
  await requester._sendRewards()
  t.true(connectionFake)
})
