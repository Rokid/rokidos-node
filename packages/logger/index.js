'use strict'
var util = require('util')

/**
 * @module logger
 * @description logger functionalities.
 *
 * The above command would starts a tcp server on the port 8000 for logs.
 */

var native
if (process.platform !== 'darwin') {
  native = require('./logger.node')
} else {
  native = {
    enableCloud: function () {},
    print: function native (lvl, tag, line) {
      var level = Object.keys(logLevels)[lvl - 1]
      console[level](`${new Date().toISOString()} [${level.toUpperCase()}] <${tag}>`, line)
    }
  }
}

var logLevels = {
  'verbose': 1,
  'debug': 2,
  'info': 3,
  'warn': 4,
  'error': 5
}

/**
 * @constructor
 * @param {String} name - the logger name
 */
function Logger (name) {
  this.name = name || 'default'
}

function createLoggerFunction (level) {
  level = logLevels[level]
  if (!level || level < 1 || level > 5) {
    level = 3 // info
  }
  return function printlog () {
    var line = ''
    if (arguments.length === 1) {
      line = util.formatValue(arguments[0])
    } else if (arguments.length === 2) {
      line = `${util.formatValue(arguments[0])} ${util.formatValue(arguments[1])}`
    } else {
      line = util.format.apply(util, arguments)
    }
    if (line.length >= 1024) {
      line = line.slice(0, 1024) + '...'
    }
    native.print(level, this.name, line)
  }
}

/**
 * log level: verbose
 */
Logger.prototype.verbose = createLoggerFunction('verbose')

/**
 * log level: debug
 */
Logger.prototype.debug = createLoggerFunction('debug')

/**
 * log level: log
 */
Logger.prototype.log = createLoggerFunction('info')

/**
 * log level: info
 */
Logger.prototype.info = createLoggerFunction('info')

/**
 * log level: warn
 */
Logger.prototype.warn = createLoggerFunction('warn')

/**
 * log level: error
 */
Logger.prototype.error = createLoggerFunction('error')

/**
 * @example
 * var logger = require('logger')('some tag')
 * logger.log('test')
 * logger.error('something went wrong')
 *
 * @function defaults
 * @param {String} name - the log tag
 */
module.exports = function (name) {
  return new Logger(name)
}

var UPLOAD_MIN_LEVEL = 0
var UPLOAD_MAX_LEVEL = 5

// disable cloud by default
native.enableCloud(UPLOAD_MIN_LEVEL, '')

/**
 * enable log upload to cloud
 *
 * @example
 * var enableGlobalUploadCloud = require('logger').setGlobalUploadLevel
 * setGlobalUploadLevel(level, "your gw token")
 *
 * @function defaults
 * @param {Number} uploadLevel - [UPLOAD_MIN_LEVEL, UPLOAD_MAX_LEVEL]
 * @param {String} token
 */
module.exports.setGlobalUploadLevel = function (uploadLevel, authorization) {
  if (uploadLevel > UPLOAD_MAX_LEVEL || uploadLevel < UPLOAD_MIN_LEVEL) {
    throw new Error(
      `upload level should between ${UPLOAD_MIN_LEVEL},${UPLOAD_MAX_LEVEL}`
    )
  }
  native.enableCloud(uploadLevel, authorization)
}

module.exports.UPLOAD_MIN_LEVEL= UPLOAD_MIN_LEVEL
module.exports.UPLOAD_MAX_LEVEL= UPLOAD_MAX_LEVEL
