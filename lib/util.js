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
  return inquirer.prompt([ {
    type: 'password',
    name: 'password',
    message
  } ])
}

async function promptForDid(message) {
  message = message || 'Please provide the Ara identity associated with the AFS.\n' +
    'DID:'
  return inquirer.prompt([ {
    type: 'string',
    name: 'did',
    message
  } ])
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

  dcdn.on('start', (did, total) => {
    if (visualizers.has(did)) return
    info(`Download started for ${did}`)
    const pBar = new clip.Bar({}, clip.Presets.shades_classic)
    pBar.start(total, 0)
    visualizers.set(did, pBar)
  })

  dcdn.on('progress', (did, value) => {
    if (!visualizers.has(did)) return
    const pBar = visualizers.get(did)
    pBar.update(value)
  })

  dcdn.on('complete', (did) => {
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

  dcdn.on('requestcomplete', (key) => {
    info(`Request complete for ${key}`)
  })
}

module.exports = {
  displayConfirmationPrompt,
  promptForPassword,
  promptForDid,
  displayEvents,
  onClose
}
