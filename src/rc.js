const rc = require('ara-runtime-configuration')
const { resolve } = require('path')
const extend = require('extend')

const DCDN_DIR = 'dcdn'
const DEFAULT_CONFIG_STORE = 'store.json'
const DEFAULT_JOB_STORE = 'jobs.json'

const defaults = () => ({
  dcdn: {
    root: resolve(rc().data.root, DCDN_DIR),
    config: resolve(rc().data.root, DCDN_DIR, DEFAULT_CONFIG_STORE),
    jobs: resolve(rc().data.root, DCDN_DIR, DEFAULT_JOB_STORE)
  }
})

module.exports = conf => rc(extend(true, {}, defaults(), conf))
