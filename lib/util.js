const { format } = require('util')
const differ = require('ansi-diff-stream')
const assert = require('assert')

const streams = {
  warn: makeAnsiDiffStream(process.stderr),
  error: makeAnsiDiffStream(process.stderr),
  fatal: makeAnsiDiffStream(process.stderr),

  log: makeAnsiDiffStream(process.stderr),
  info: makeAnsiDiffStream(process.stderr),
  // info: process.stderr,
}

function makeAnsiDiffStream(target) {
  const diff = differ()
  target.setMaxListeners(0)
  diff.setMaxListeners(0)
  diff.pipe(target)
  return diff
}

function insertPrefix(prefix, string) {
  return String(string)
    .trim()
    .split(/\r?\n/)
    .map(line => `${kOutputPrefix} ${prefix}: ${line}`)
    .join('\n')
    .trim()
}

const kOutputPrefix = 'cfs:'

/**
 * Outputs formatted error messages to stderr.
 *
 * @public
 * @param {String} message
 * @param {...String} args
 */
function error(message, ...args) {
  streams.error.write(insertPrefix('error', format(message, ...args)))
}

/**
 * Outputs formatted warning messages to stderr.
 *
 * @public
 * @param {String} message
 * @param {...String} args
 */
function warn(message, ...args) {
  streams.warn.write(insertPrefix('warn', format(message, ...args)))
}

/**
 * Outputs formatted fatal messages to stderr and exits with
 * a status code of 1.
 *
 * @public
 * @param {String} message
 * @param {...String} args
 */
function fatal(message, ...args) {
  streams.fatal.write(insertPrefix('fatal', format(message, ...args)))
  process.exit(1)
}

/**
 * Outputs formatted messages to stdout.
 *
 * @public
 * @param {String} message
 * @param {...String} args
 */
function info(message, ...args) {
  streams.info.write(insertPrefix('info', format(message, ...args)))
}

/**
 * Outputs formatted messages to stdout.
 *
 * @public
 * @param {String} message
 * @param {...String} args
 */
function log(message, ...args) {
  streams.log.write(insertPrefix('log', format(message, ...args)))
}

/**
 * Unreachable function that throws an error if called
 * @public
 * @throws AssertionError
 */
function unreachable() {
  assert(0, 'UNREACHABLE')
}

/**
 * Concats n arrays into a given target array
 * @public
 * @param {Array} target
 * @param {...Array} arrays
 * @return {Array}
 */
function concat(target, ...arrays) {
  for (const array of arrays) {
    for (const k of array) {
      target.push(k)
    }
  }
  return target
}

module.exports = {
  concat,
  error,
  fatal,
  info,
  log,
  unreachable,
  warn,
}
