const { test } = require('ava')
const sinon = require('sinon')
const index = require('../index')
const dcdn = require('../src/dcdn')

const inst = sinon.createStubInstance(dcdn)

test.beforeEach(async (t) => {
  await index.setInstance(null)
})

test('index.getInstance', async (t) => {
  t.true(null === await index.getInstance())
})

test('index.setInstance', async (t) => {
  await index.setInstance(inst)
  t.true(inst === await index.getInstance())
})

test('index.start', async (t) => {
  await index.setInstance(inst)

  t.true(await index.start({ did: 'test' }))
  t.true(inst.join.calledOnce)

  t.true(await index.start())
  t.true(inst.start.calledOnce)
})

test('index.stop', async (t) => {
  await index.setInstance(inst)

  t.true(await index.stop({ did: 'test' }))
  t.true(inst.unjoin.calledOnce)

  t.true(await index.stop())
  t.true(inst.stop.calledOnce)
})

test.todo('index.configure')
