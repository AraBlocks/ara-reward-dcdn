const sinon = require('sinon')
const test = require('ava')
const { Countdown } = require('../src/util')

test('util.Countdown.decrement', async (t) => {
  const countdownFake = sinon.fake()
  const countdown = new Countdown(2, countdownFake)

  countdown.decrement()
  countdown.decrement()

  t.true(countdownFake.notCalled)

  countdown.start()
  t.true(countdownFake.calledOnce)
})

test.todo('util.isUpdateAvailable')
test.todo('util.isJobOwner')
test.todo('util.verify')
