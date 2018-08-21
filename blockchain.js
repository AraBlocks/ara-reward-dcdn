const { secrets } = require('ara-network')
const debug = require('debug')('ara:dcdn:blockchain')
const pify = require('pify')
const aid = require('ara-identity')

async function checkBlockchain(did) {
  // Handwaving as of 08/06/2018

  // maddie
  //   Verifying that something has been committed is getting anything from the read method from the storage contract when you pass the relevant parameters? (edited)
  // eric
  //   nope you’d query the `Registry` contract
  //   and check if `hash(contentDid)` has a non-zero address
  //   https://github.com/AraBlocks/ara-contracts/blob/ej_rewards/contracts/Registry.sol#L7
  // charles
  //   yeah i would be on eric’s current branch, not master
  // eric
  //   although this isn’t in the AFS repo
  //   this is a relatively large refactor that isn’t done yet, so if you have any questions @maddie feel free to ask
  // maddie
  //   So this part is not yet in so I should just handwave it for now?
  // eric
  //   yes
  // maddie
  //   :ok_hand::skin-tone-2: Thanks!
  // eric
  //   although this is what you will call
  //   https://github.com/AraBlocks/ara-contracts/blob/ej_rewards/registry.js#L27
  //   if you were curious

  return true

  // return proxyExists(did)
}

module.exports = {
  checkBlockchain,
}