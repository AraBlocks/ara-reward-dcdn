const { resolve } = require('path')
const { error } = require('ara-console')
const extend = require('extend')
const FarmDCDN = require('./farmDCDN')
const rc = require('ara-runtime-configuration')()

let afd

/**
 * Start an ara-network node for DCDN
 *
 * @public
 *
 * @param {Object} argv
 *
 * @return {Boolean}
 */

async function start(argv) {
  if (!argv.upload && !argv.download) {
    error('Please specify either `--upload` or `--download`')
    return process.exit(1)
  }

  afd = new FarmDCDN(argv)

  afd.start()

  // If we are downloading, we should set up a handshake so we can be reached from `afd publish`
  if (argv.download && argv.keyring) {
    try {
      await listenForDIDs({
        // Identity of the user
        identity: argv.identity,
        // Secret phrase given when creating network key
        secret: Buffer.from(argv.secret),
        // Name of the key to be found
        name: argv.name,
        // Path to public key of network key
        keys: resolve(argv.keyring),
        // Port to advertise ourselves on
        port: argv.port,
      }, afd.join)
    } catch (e) {
      error('Error occurred while listening for DIDs', e)
      return process.exit(1)
    }
  }

  return true
}

/**
 * Stop the ara-network node of DCDN
 *
 * @return {null}
 */
async function stop() {
  afd.stop()
}

/**
 * Configures the ara-network DCDN node
 *
 * @public
 *
 * @param {Object} opts
 *
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
  configure,
  start,
  stop,
}
