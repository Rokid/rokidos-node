'use strict'

var path = require('path')
var hive = require('@yoda/hive/lib/hive-cli')
var logger = require('logger')('hive')

var hivesock = '/var/run/hive.sock'
var pidExitCallbackMap = {}
hive.initHiveProc(pid => {
  logger.info(`Process(${pid}) exited.`)
  var callback = pidExitCallbackMap[pid]
  delete pidExitCallbackMap[pid]
  if (typeof callback !== 'function') {
    return
  }
  callback()
}, hivesock)

var kAppModesInstrument = require('../constants').AppScheduler.modes.instrument

var entriesDir = path.join(__dirname, '..', 'client')
var defaultEntry = path.join(entriesDir, 'ext-app-entry.js')
var instrumentEntry = path.join(entriesDir, 'ext-instrument-entry.js')

module.exports = launchHiveApp
/**
 *
 * @param {string} appId -
 * @param {object} metadata - app metadata
 * @param {AppBridge} bridge -
 * @param {number} mode - running mode
 * @param {object} [options]
 * @param {string} [options.descriptorPath] - api descriptor file to be used
 * @param {string[]} [options.args] - additional execution arguments to the child process
 * @param {object} [options.environs] - additional execution arguments to the child process
 */
function launchHiveApp (appDir, bridge, mode, options) {
  options = options || {}
  var entry = defaultEntry
  if (mode & kAppModesInstrument) {
    entry = instrumentEntry
  }

  var descriptorPath = options.descriptorPath
  if (descriptorPath == null) {
    descriptorPath = path.join(__dirname, '../client/api/default.json')
  }

  var execArgs = [ appDir, descriptorPath ]
  if (options.args) {
    execArgs = execArgs.concat(options.args)
  }
  var env = Object.assign({}, process.env, options.environs)
  var environs = Object.keys(env).reduce((accu, key) => {
    accu.push(key)
    accu.push(env[key])
    return accu
  }, [])

  return hive.requestFork(appDir, [entry].concat(execArgs), environs, hivesock)
    .then(pid => {
      bridge.logger.info(`Forked child process ${appDir}(${pid}).`)

      bridge.implement({
        anrEnabled: true,
        exit: (force) => {
          if (force) {
            bridge.logger.info(`force stop process(${pid}).`)
            process.kill(pid, /** SIGKILL */9)
            return
          }
          bridge.logger.info(`Process(${pid}) end of life, killing process after 1s.`)
          setTimeout(() => process.kill(pid), 1000)
        }
      })
      pidExitCallbackMap[pid] = () => {
        bridge.logger.info(`Process(${pid}) exited.`)
        bridge.didExit()
      }

      return pid
    })
}
