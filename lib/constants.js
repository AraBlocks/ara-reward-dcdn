/**
 * The original program arguments with the node binary and
 * this script path removed. If the program has no arguments,
 * then this value will be 0.
 *
 * @public
 * @const
 * @type {Array}
 */
const kOriginalProgramArguments =
  Object.freeze(Object.seal(Object.assign([], process.argv.slice(2))))

module.exports = {
  kOriginalProgramArguments,
}
