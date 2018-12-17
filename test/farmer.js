const { library, rewards } = require('ara-contracts')
const { Farmer } = require('../src/farmer')
const sinon = require('sinon')
const User = require('../src/user')
const util = require('ara-util')
const test = require('ava')
const arp = require('ara-reward-protocol')

const {
  Agreement,
  Reward,
  Quote,
  SOW,
  Signature
} = arp.messages

const TEST_REQUESTER = 'abcd'
const TEST_REWARD = 10
const TEST_DISCOVERY_KEY = 'ab123c'
const TEST_AFS = {
  discoveryKey: Buffer.from(TEST_DISCOVERY_KEY, 'hex'),
  partitions: {
    home: {
      content: {
        on: () => true,
        replicate: () => true
      },
      metadata: {
        ready: (cb) => { cb() },
      },
      _ensureContent: (cb) => { cb() }
    }
  },
}
const TEST_SWARM = { }
const TEST_USER = new User('did', 'pass')
const TEST_SIGNATURE = new Signature()

sinon.stub(TEST_USER, 'sign').returns(TEST_SIGNATURE)
sinon.stub(TEST_USER, 'verify').returns(true)

sinon.stub(util, 'getAddressFromDID').resolves(TEST_REQUESTER)
sinon.stub(library, 'hasPurchased').resolves(true)
sinon.stub(rewards, 'getBudget').resolves(TEST_REWARD)
sinon.stub(rewards, 'getJobOwner').resolves(TEST_REQUESTER)

test('farmer.validateSow.valid', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const sow = new SOW()
  sow.setTopic(TEST_DISCOVERY_KEY)

  t.true(await farmer.validateSow(sow))
})

test('farmer.generateQuote', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const jobNonce = Buffer.from('did', 'hex')
  const sow = new SOW()
  sow.setNonce(jobNonce)

  const quote = await farmer.generateQuote(sow)
  t.true(quote.getSignature() == TEST_SIGNATURE && TEST_REWARD == quote.getPerUnitCost() && quote.getSow() == sow)
})

test('farmer.signAgreement', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const agreementNonce = Buffer.from('did', 'hex')
  const agreement = new Agreement()
  agreement.setNonce(agreementNonce)

  const signAgreement = await farmer.signAgreement(agreement)
  t.true(signAgreement.getSignature() == TEST_SIGNATURE && arp.util.nonceString(signAgreement) == agreementNonce)
})

test('farmer.generateReceipt', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const sow = new SOW()
  sow.setNonce(Buffer.from('did', 'hex'))
  const quote = new Quote()
  quote.setSow(sow)
  const agreement = new Agreement()
  agreement.setQuote(quote)
  const reward = new Reward()
  reward.setAgreement(agreement)

  const receipt = await farmer.generateReceipt(reward)
  t.true(receipt.getSignature() == TEST_SIGNATURE && receipt.getReward() == reward)
})

test('farmer.validateReward', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const agreement = new Agreement()
  const reward = new Reward()
  reward.setAgreement(agreement)

  t.true(await farmer.validateReward(reward))
})

test('farmer.validateAgreement.valid', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const sow = new SOW()
  sow.setNonce('abcd')
  const quote = new Quote()
  quote.setSow(sow)
  const agreement = new Agreement()
  agreement.setSignature(TEST_SIGNATURE)
  agreement.setQuote(quote)

  t.true(await farmer.validateAgreement(agreement))
})

test('farmer.validateAgreement.invalidrequester', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(false)

  const farmer = new Farmer({
    user,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const sow = new SOW()
  sow.setNonce('abcd')
  const quote = new Quote()
  quote.setSow(sow)
  const agreement = new Agreement()
  agreement.setSignature(signature)
  agreement.setQuote(quote)

  t.false(await farmer.validateAgreement(agreement))
})

test('farmer.stop', async (t) => {
  let leaveFake = false
  const swarm = {
    leave: () => {
      leaveFake = true
    }
  }

  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm
  })
  await farmer.stop()
  t.true(leaveFake)
})

test('farmer.onHireConfirmed', async (t) => {
  const replicateFake = sinon.fake()
  const afs = {
    discoveryKey: Buffer.from(TEST_DISCOVERY_KEY, 'hex'),
    partitions: {
      home: {
        content: {
          on: () => true,
          replicate: replicateFake
        },
        metadata: {
          ready: (cb) => { cb() },
        },
        _ensureContent: (cb) => { cb() }
      }
    },
  }

  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs,
    swarm: TEST_SWARM
  })

  const signature = new Signature()
  signature.setDid('ab123')
  const sow = new SOW()
  sow.setNonce('abcd')
  sow.setSignature(signature)
  const quote = new Quote()
  quote.setSow(sow)
  const agreement = new Agreement()
  agreement.setQuote(quote)

  const fakeError = sinon.fake()

  const connection = {
    onError: fakeError,
    stream: {
      destroyed: false
    }
  }

  await farmer.onHireConfirmed(agreement, connection)

  t.true(fakeError.notCalled)
  t.true(replicateFake.calledOnce)
})
