const extend = require('extend')
const DCDN = require('./src/dcdn')
const rc = require('ara-runtime-configuration')()
const debug = require('debug')('ard')

let instance = null

/**
 * Start broadcasting services for an ara-network node for DCDN
 * @public
 * @param {Object} argv
 * @return {Boolean}
 */

async function start(argv = {}) {
  if (!instance) instance = new DCDN({ userId: argv.identity, password: argv.password })
  const { did } = argv
  if (did) {
    await instance.join({
      did: argv.did,
      download: argv.download,
      upload: argv.upload,
      metaOnly: argv['meta-only'],
      price: argv.reward,
      maxPeers: argv.peers,
      jobId: argv['job-id']
    })
  } else {
    await instance.start()
  }

  process.on('SIGINT', async () => {
    debug('process interrupted...')
    await instance.stop()
    process.exit()
  })

  return true
}

/**
 * Stop the ara-network node of DCDN
 * @public
 * @return {null}
 */
async function stop(argv = {}) {
  if (!instance) return false

  const { did } = argv
  if (did) {
    await instance.unjoin({ did })
  } else {
    await instance.stop()
    instance = null
  }
  return true
}

/**
 * Configures the ara-network DCDN node
 * @public
 * @param {Object} opts
 * @return Object
 */
async function configure(argv, program) {
  if (program) {
    const { argv: _argv } = program
      .option('help', {
        alias: 'h',
        describe: 'Show this help message'
      })
      .option('debug', {
        alias: 'D',
        describe: 'Enable debug output'
      })
      .option('did', {
        alias: 'd',
        describe: 'The identity of the AFS of interest',
        default: null
      })
      .option('reward', {
        alias: 'r',
        describe: '`The maximum reward for the AFS',
        default: null
      })
      .option('peers', {
        alias: 'p',
        describe: 'The maximum number of simulataneous peers per AFS',
        default: null
      })
      .option('job-id', {
        describe: 'The job Id for the AFS',
        default: null
      })
      .option('meta-only', {
        describe: 'Whether to only upload/download the metadata',
        default: false
      })
      .option('download', {
        describe: 'Whether the node should download',
        default: false
      })
      .option('upload', {
        describe: 'Whether the node should upload',
        default: false
      })
      .option('identity', {
        alias: 'i',
        describe: 'Your Ara identity',
        default: rc.network.identity.whoami
      })

    // eslint-disable-next-line no-param-reassign
    argv = extend(true, argv, _argv)
  }
}

/**
 * Gets the DCDN object
 *
 * @return {Object}
 */
async function getInstance() {
  return instance
}

/**
 * Sets the DCDN object
 */
async function setInstance(obj) {
  if (obj instanceof DCDN) instance = obj
}

module.exports = {
  getInstance,
  setInstance,
  configure,
  start,
  stop
}
