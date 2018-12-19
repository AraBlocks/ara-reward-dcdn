const { messages } = require('ara-reward-protocol')

const {
  Agreement,
  Quote,
  Signature
} = messages

function generateAgreement(did, price) {
  const signature = new Signature()
  signature.setDid(did)
  const quote = new Quote()
  quote.setSignature(signature)
  quote.setPerUnitCost(price)
  const agreement = new Agreement()
  agreement.setQuote(quote)

  return agreement
}

module.exports = {
  generateAgreement
}
