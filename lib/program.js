const { error } = require('ara-console')
const { basename } = require('path')

/*
 * we use this hack to notify child processes that they were invoked
 * from the `afs(1)` shell command
 */
const FROM_ARD_PARENT_FLAG = 'from-ard-parent'

if (process.argv.join('').indexOf(FROM_ARD_PARENT_FLAG) > -1) {
  removeAFSParentFlagFromArgv(process.argv)
  process.title = `[ard/${basename(process.argv[1]).replace('ard-', '')}]`
} else {
  process.title = basename(process.argv[1])
}

// this MUST be required after the `process.argv` hax done above
// eslint-disable-next-line import/no-unresolved
const program = require('yargs')

/*
 * We can configure all programs this way
 * and allow the creation of a "new" one through
 * the `createProgram()` function
 */
const { argv } = program
  .help(false)
  .version(false)
  .option('help', {
    describe: 'Show this message',
    alias: 'h',
  })
  .option('version', {
    describe: 'Show AFS CLI version',
    alias: 'V',
  })

  // TODO: enable verbose mode
  // .option('verbose', {
  //   describe: 'Show verbose output',
  //   alias: 'v',
  // })

/**
 * Returns a pre configured yargsa program object
 * with defaults and usage.
 *
 * @public
 * @param {Object} opts
 * @param {String} opts.usage
 * @return {Object}
 */
function createProgram({ usage }) {
  return program
    .usage(String(usage).trim())
    .option(FROM_ARD_PARENT_FLAG, {
      hidden: true,
    })
}

function removeAFSParentFlagFromArgv(args) {
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i]
    if (arg.replace('--', '') == FROM_ARD_PARENT_FLAG) {
      args.splice(i, 1)
    }
  }
}

/*
 * handle unhandledRejection errors thrown from async
 * functions or promises
 */
process.on('unhandledRejection', (err) => {
  error('An unhandledRejection occured: %s', err)
})

// handle uncaughtException errors thrown from anywhere
process.on('uncaughtException', (err) => {
  error('An uncaughtException occured: %s', err)
})

module.exports = {
  FROM_ARD_PARENT_FLAG,
  createProgram,
  argv
}
