const {
  messages,
  util
} = require('ara-farming-protocol')
const library = require('ara-contracts/library')
const { User } = require('../src/util')
const { Farmer } = require('../src/farmer')

const {
  Agreement,
  Reward,
  Quote,
  SOW,
  Signature
} = messages
const sinon = require('sinon')
const test = require('ava')

const user = new User('did', 'pass')
const farmer = new Farmer(user, 10, '')
const signature = new Signature()
sinon.stub(user, 'sign').returns(signature)
sinon.stub(user, 'verify').returns(true)
sinon.stub(signature, 'getData').returns('data')

test('farmer.generateQuote', async (t) => {
  const jobNonce = Buffer.from('did', 'hex')
  const sow = new SOW()
  sow.setNonce(jobNonce)

  const quote = await farmer.generateQuote(sow)
  t.true(quote.getSignature() == signature && 10 == quote.getPerUnitCost() && quote.getSow() == sow)
})

test('farmer.signAgreement', async (t) => {
  const agreementNonce = Buffer.from('did', 'hex')
  const agreement = new Agreement()
  agreement.setNonce(agreementNonce)

  const signAgreement = await farmer.signAgreement(agreement)
  t.true(signAgreement.getSignature() == signature && util.nonceString(signAgreement) == agreementNonce)
})

test('farmer.generateReceipt', async (t) => {
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
  const agreement = new Agreement()
  const reward = new Reward()
  reward.setAgreement(agreement)

  const validation = await farmer.validateReward(reward)
  t.true(validation)
})

test('farmer.validateAgreement', async (t) => {
  sinon.stub(library, 'hasPurchased').resolves(true)
  const quote = new Quote()
  const agreement = new Agreement()
  agreement.setSignature(signature)
  agreement.setQuote(quote)

  const validation = await farmer.validateAgreement(agreement)
  t.true(validation)
})

test('farmer.stop', async (t) => {
  let leaveFake = false
  const afs = { discoveryKey: 'key' }
  const swarm = {
    leave: () => {
      leaveFake = true
    }
  }
  farmer.afs = afs
  farmer.swarm = swarm

  await farmer.stop()
  t.true(leaveFake)
})
