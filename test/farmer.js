const { library, rewards } = require('ara-contracts')
const { Farmer } = require('../src/farmer')
const sinon = require('sinon')
const User = require('../src/user')
const util = require('ara-util')
const test = require('ava')
const afp = require('ara-reward-protocol')

const {
  Agreement,
  Reward,
  Quote,
  SOW,
  Signature
} = afp.messages

const TEST_REQUESTER = 'abcd'
const TEST_REWARD = 10
const TEST_DISCOVERY_KEY = 'ab123c'
const TEST_AFS = {
  discoveryKey: Buffer.from(TEST_DISCOVERY_KEY, 'hex')
}
const TEST_SWARM = { }

sinon.stub(util, 'getAddressFromDID').resolves(TEST_REQUESTER)
sinon.stub(library, 'hasPurchased').resolves(true)
sinon.stub(rewards, 'getBudget').resolves(TEST_REWARD)
sinon.stub(rewards, 'getJobOwner').resolves(TEST_REQUESTER)

test('farmer.validateSow.valid', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  const farmer = new Farmer({
    user,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const sow = new SOW()
  sow.setTopic(TEST_DISCOVERY_KEY)

  t.true(await farmer.validateSow(sow))
})

test('farmer.generateQuote', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  const farmer = new Farmer({
    user,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const jobNonce = Buffer.from('did', 'hex')
  const sow = new SOW()
  sow.setNonce(jobNonce)

  const quote = await farmer.generateQuote(sow)
  t.true(quote.getSignature() == signature && TEST_REWARD == quote.getPerUnitCost() && quote.getSow() == sow)
})

test('farmer.signAgreement', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  const farmer = new Farmer({
    user,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })
  const agreementNonce = Buffer.from('did', 'hex')
  const agreement = new Agreement()
  agreement.setNonce(agreementNonce)

  const signAgreement = await farmer.signAgreement(agreement)
  t.true(signAgreement.getSignature() == signature && afp.util.nonceString(signAgreement) == agreementNonce)
})

test('farmer.generateReceipt', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  const farmer = new Farmer({
    user,
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
  t.true(receipt.getSignature() == signature && receipt.getReward() == reward)
})

test('farmer.validateReward', async (t) => {
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  const farmer = new Farmer({
    user,
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
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

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
  const user = new User('did', 'pass')
  const signature = new Signature()
  sinon.stub(user, 'sign').returns(signature)
  sinon.stub(user, 'verify').returns(true)

  let leaveFake = false
  const swarm = {
    leave: () => {
      leaveFake = true
    }
  }

  const farmer = new Farmer({
    user,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm
  })
  await farmer.stop()
  t.true(leaveFake)
})
