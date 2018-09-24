const { resolve } = require('path')
const { error } = require('ara-console')
const extend = require('extend')
const FarmDCDN = require('./src/farmDCDN')
const rc = require('ara-runtime-configuration')()

let afd

function initialize(argv) {
  if (afd) return false
  afd = new FarmDCDN(argv)
  return true
}

/**
 * Start broadcasting services for an ara-network node for DCDN
 * @public
 * @param {Object} argv
 * @return {Boolean}
 */

async function start(argv) {
  if (afd) return false
  initialize(argv)
  await afd.start()
  return true
}

/**
 * Stop the ara-network node of DCDN
 * @return {null}
 */
async function stop() {
  if (!afd) return false 
  await afd.stop()
  afd = null
  return true
}

/**
 * Configures the ara-network DCDN node
 * @public
 * @param {Object} opts
 * @return Object
 */
// TODO: Update configure for Farming
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
        describe: 'A static DID to advertise',
        default: null
      })
      .option('port', {
        alias: 'port',
        describe: 'Port to advertise on',
        default: 5000
      })
      .option('upload', {
        describe: 'Where the node should upload',
        default: false
      })
      .option('download', {
        describe: 'Whether the node should download',
        default: false
      })
      .option('secret', {
        alias: 's',
        describe: 'Network key secret',
        default: null
      })
      .option('name', {
        alias: 'n',
        describe: 'Network key name',
        default: null
      })
      .option('keyring', {
        alias: 'k',
        describe: 'Path to keyring',
        default: rc.network.identity.keyring
      })
      .option('identity', {
        alias: 'i',
        describe: 'Your Ara identity, to be used in a handshake',
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
  return afd
}

module.exports = {
  getInstance,
  initialize,
  configure,
  start,
  stop
}
