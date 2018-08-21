const { createSwarm, createChannel } = require('ara-network/discovery/swarm')
const { create: createAFS } = require('ara-filesystem')
const { info, warn, error } = require('ara-console')
const { listenForDIDs } = require('./subnet')
const { loadSecrets } = require('ara-filesystem/util')
const { resolve } = require('path')
const multidrive = require('multidrive')
const through = require('through')
const toilet = require('toiletdb')
const extend = require('extend')
const debug = require('debug')('ara:dcdn:dcdn')
const pump = require('pump')
const pify = require('pify')
const net = require('net')
const rc = require('ara-runtime-configuration')()

const store = toilet('./afses.json')

let driveCreator
let afses = {}
let staticDID = null
let swarm = null
let shouldUpload = false
let shouldDownload = false

async function join(did) {
  afses[did] = await pify(driveCreator.create)(did)

  swarm.join(did, { announce: Boolean(shouldDownload) })
  debug(`joined ${did} channel`)
}

function stream(peer) {
  let { channel: did } = peer

  did = did || staticDID

  // // This function always must return streams, so return an empty one
  if (!did || Object.keys(afses).indexOf(did.toString()) == -1) {
    debug(`Replicating empty stream`)
    return through().setMaxListeners(Infinity)
  }

  debug(`Replicating ${did} with download=${shouldDownload} upload=${shouldUpload}`)
  const stream = afses[did].replicate({
    upload: shouldUpload,
    download: shouldDownload,
  })

  stream.peer = peer

  if (shouldDownload) {
    debug(`requesting download of ${did}'s HOME partition`)
    afses[did].download('/')
  }

  afses[did].on('sync', () => {
    let action = []
    if (shouldUpload) {
      action.push('uploading')
    }

    if (shouldDownload) {
      action.push('downloading')
    }

    debug(`Finished ${action.join(' + ')}!`)
  })

  return stream
}

/**
 * Start a DCDN node
 *
 * @public
 *
 * @param {Object} argv
 *
 * @return Stream
 */

async function start(argv) {
  if (!argv.upload && !argv.download) {
    throw new Error('Please specify either `--upload` or `--download`')
  }

  shouldDownload = argv.download
  shouldUpload = argv.upload
  staticDID = argv.did

  // For persisting AFSes
  driveCreator = await pify(multidrive)(store, create, close)

  async function create (did, done) {
    debug(`initializing afs of ${did}`)
    const { afs } = await createAFS({ did })
    done(null, afs)
  }

  function close (afs, done) {
    debug(`closing afs`)
    afs.close()
    done()
  }

  // We only need one swarm and then swap out streams as needed
  swarm = createSwarm({ stream })

  swarm.on('connection', (_, info) => {
    debug(`connected to peer ${info.host}:${info.port}`)
  })

  // If we are only advertising one DID, join it straight away
  if (staticDID) {
    debug(`joining a static DID ${staticDID}`)
    join(staticDID)
  }

  // If we are downloading, we should set up a handshake so we can be reached from `dcdn publish`
  if (shouldDownload) {
    listenForDIDs({
      // Identity of the user
      identity: argv.identity,
      // Secret phrase given when creating network key
      secret: Buffer.from(argv.secret),
      // Name of the key to be found
      name: argv.name,
      // Path to public key of network key
      keys: resolve(argv.keyring),
      // Port to advertise ourselves on
      port: argv.port || 5000,
    }, join)
  }

  return true
}

async function stop() {
  for (const did of Object.keys(afses)) {
    debug(`leaving ${did}`)
    swarm.leave(did)
  }
}

/**
 * Configures the DCDN node
 *
 * @public
 *
 * @param {Object} opts
 *
 * @return Object
 */

async function configure(argv, program) {
  if (program) {
    const { argv } = program
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
        default: null
      })
      .option('identity', {
        alias: 'i',
        describe: 'Your Ara identity, to be used in a handshake',
        default: null
      })
  }

  if (argv.identity && 0 != argv.identity.indexOf('did:ara:')) {
    argv.identity = `did:ara:${argv.identity}`
  }

  return extend(true, argv)
}

async function getInstance() {
  return swarm
}

module.exports = {
  getInstance,
  configure,
  start,
  stop,
}
