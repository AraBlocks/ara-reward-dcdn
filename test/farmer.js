const { library, rewards } = require('ara-contracts')
const { Farmer } = require('../src/farmer')
const sinon = require('sinon')
const User = require('../src/user')
const util = require('ara-util')
const test = require('ava')
const arp = require('ara-reward-protocol')
const {
  TEST_AFS,
  TEST_DISCOVERY_KEY,
  TEST_PEER_DID,
  TEST_REWARD,
  TEST_USER_SIGNATURE,
  TEST_PEER_SIGNATURE,
  TEST_SWARM,
  TEST_USER
} = require('./_constants')

const {
  Agreement,
  Reward,
  Quote,
  SOW,
  Signature
} = arp.messages

sinon.stub(util, 'getAddressFromDID').resolves(TEST_PEER_DID)
sinon.stub(library, 'hasPurchased').resolves(true)
sinon.stub(rewards, 'getBudget').resolves(TEST_REWARD)
sinon.stub(rewards, 'getJobOwner').resolves(TEST_PEER_DID)

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
  t.true(quote.getSignature() == TEST_USER_SIGNATURE && TEST_REWARD == quote.getPerUnitCost() && quote.getSow() == sow)
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
  t.true(signAgreement.getSignature() == TEST_USER_SIGNATURE && arp.util.nonceString(signAgreement) == agreementNonce)
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
  t.true(receipt.getSignature() == TEST_USER_SIGNATURE && receipt.getReward() == reward)
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
  agreement.setSignature(TEST_PEER_SIGNATURE)
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

test('farmer.onConnection', async (t) => {
  const farmer = new Farmer({
    user: TEST_USER,
    price: TEST_REWARD,
    afs: TEST_AFS,
    swarm: TEST_SWARM
  })

  const fakeError = sinon.fake()
  const fakePipe = sinon.fake.returns({ pipe: () => true })
  const connection = {
    onError: fakeError,
    pipe: fakePipe
  }

  await farmer.onConnection(connection, {})

  t.true(fakePipe.called)
  t.true(fakeError.notCalled)
})
