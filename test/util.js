const sinon = require('sinon')
const test = require('ava')
const { Countdown } = require('../src/util')
const User = require('../src/user')
const crypto = require('ara-crypto')

const user = new User('did', 'pass')

test('util.User.sign', async (t) => {
  user.secretKey = 'secretKey'
  const message = Buffer.from('message')
  sinon.stub(crypto, 'sign').returns(message)
  const signature = user.sign('message')
  t.true('did' == signature.getDid() && signature.getData() == message)
})

test('util.User.verify', async (t) => {
  const data = sinon.stub()
  const signature = {
    getData() { return data },
    getDid() { return 'did' }
  }
  const message = { getSignature() { return signature } }
  const verifyFake = sinon.fake()
  sinon.stub(crypto, 'verify').callsFake(verifyFake)
  user.verify(message, data)
  t.true(verifyFake.calledOnce)
})

test('util.Countdown.decrement', async (t) => {
  const countdownFake = sinon.fake()
  const countdown = new Countdown(2, countdownFake)

  countdown.decrement()
  countdown.decrement()

  t.true(countdownFake.calledOnce)
})
