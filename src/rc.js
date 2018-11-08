const rc = require('ara-runtime-configuration')
const { resolve } = require('path')
const extend = require('extend')

const DCDN_DIR = 'dcdn'
const defaults = base => ({
  network: {
    dcdn: {
      root: resolve(base.data.root, DCDN_DIR)
    }
  }
})

module.exports = conf => rc(base => extend(true, defaults(base), conf))
