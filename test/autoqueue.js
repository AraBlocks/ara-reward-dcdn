const sinon = require('sinon')
const test = require('ava')
const AutoQueue = require('../src/autoqueue')

test('autoqueue', async (t) => {
  const fake1 = sinon.fake()
  const fake2 = sinon.fake()
  const fake3 = sinon.fake()
  const fake4 = sinon.fake.returns('foo')
  const fakeErr = sinon.fake()

  const queue = new AutoQueue()
  queue.push(fake1)
  queue.push(() => {
    throw new Error()
  }).catch(() => {
    fakeErr()
  })
  queue.push(fake2)
  await queue.push(fake3)
  const foo = await queue.push(fake4)

  t.true(fake1.calledOnce)
  t.true(fake2.calledOnce)
  t.true(fake3.calledOnce)
  t.true(fake4.calledOnce)
  t.true('foo' === foo)
  t.true(fakeErr.calledOnce)
})
