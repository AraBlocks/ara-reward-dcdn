const { info, warn, error } = require('ara-console')
const inquirer = require('inquirer')
const clip = require('cli-progress')
const { stop } = require('..')

/**
 * For functions that all subcommands share.
 */

async function promptForPassword(message) {
  message = message || 'Please provide the passphrase for your identity. This is needed to ' +
    'complete this action.\n' +
    'Passphrase:'
  const { password } = await inquirer.prompt([ {
    type: 'password',
    name: 'password',
    message
  } ])
  return password
}

async function promptForDid(message) {
  message = message || 'Please provide the Ara identity associated with the AFS.\n' +
    'DID:'
  const { did } = await inquirer.prompt([ {
    type: 'string',
    name: 'did',
    message
  } ])
  return did
}

async function onClose(err) {
  if (err) {
    error('fatal:', (err.message) ? err.message : err)
    process.exit(1)
  } else {
    try {
      await stop()
      process.exit(0)
    } catch (e) {
      error('fatal:', e)
      process.exit(1)
    }
  }
}

async function displayConfirmationPrompt({
  name = 'answer',
  message = 'Are you sure you want to continue?'
} = {}) {
  return inquirer.prompt([ {
    name,
    type: 'confirm',
    message
  } ])
}

function displayEvents(dcdn) {
  // Creates a progress visualizer bar in cli
  const visualizers = new Map()

  dcdn.on('download-progress', (did, value, total) => {
    let pBar
    if (visualizers.has(did)) {
      pBar = visualizers.get(did)
    } else {
      info(`Download started for ${did}`)
      pBar = new clip.Bar({}, clip.Presets.shades_classic)
      pBar.start(total, 0)
      visualizers.set(did, pBar)
    }
    pBar.update(value)
  })

  dcdn.on('download-complete', (did) => {
    if (!visualizers.has(did)) return
    const pBar = visualizers.get(did)
    pBar.stop()
    info(`Download complete for ${did}`)
    visualizers.delete(did)
  })

  dcdn.on('info', (message) => {
    info(message)
  })

  dcdn.on('warn', (message) => {
    warn(message)
  })

  dcdn.on('request-complete', (did) => {
    info(`Request complete for ${did}`)
  })
}

module.exports = {
  displayConfirmationPrompt,
  promptForPassword,
  promptForDid,
  displayEvents,
  onClose
}
