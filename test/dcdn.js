const test = require('ava')
const DCDN = require('../src/dcdn')

test.todo('dcdn.start')
test.todo('dcdn.stop')
test.todo('dcdn.join')
test.todo('dcdn.unjoin')

const TEST_USER_NORMALIZE = 'did:ara:1234abcd'
const TEST_USER_IDENTIFIER = '1234abcd'
const TEST_PASSWORD = 'abcd'

test('dcdn.constructor', (t) => {
  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userID: TEST_USER_NORMALIZE,
    password: TEST_PASSWORD
  })))

  /* eslint-disable-next-line no-new */
  t.true(Boolean(new DCDN({
    userID: TEST_USER_IDENTIFIER,
    password: TEST_PASSWORD
  })))

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN({}) }, Error)

  /* eslint-disable-next-line no-new */
  t.throws(() => { new DCDN() }, Error)
})
