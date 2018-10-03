const rc = require('ara-runtime-configuration')
const { resolve } = require('path')
const extend = require('extend')
const os = require('os')

const ARA_DIR = '.ara'
const DCDN_DIR = 'dcdn'
const DEFAULT_CONFIG_STORE = 'store.json'
const DEFAULT_JOB_STORE = 'jobs.json'

const defaults = () => ({
  dcdn: {
    root: resolve(os.homedir(), ARA_DIR, DCDN_DIR),
    config: resolve(os.homedir(), ARA_DIR, DCDN_DIR, DEFAULT_CONFIG_STORE),
    jobs: resolve(os.homedir(), ARA_DIR, DCDN_DIR, DEFAULT_JOB_STORE)
  }
})

module.exports = conf => rc(extend(true, {}, defaults(), conf))