const url = require('url')
const rc = require('ara-runtime-configuration')()

const providerURL = url.parse(rc.web3.provider)

module.exports = {
  networks: {
    development: {
      host: `${providerURL.hostname}`,
      port: `${providerURL.port}`,
      network_id: '*'
    }
  }
}
