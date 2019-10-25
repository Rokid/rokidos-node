'use strict'
var logger = require('logger')('scheduler')
var _ = require('@yoda/util')._
var system = require('@yoda/system')

var Constants = require('../constants').AppScheduler
var AppBridge = require('../app/app-bridge')
var lightLauncher = require('../app/light-launcher')
var defaultLauncher = require('../app/default-launcher')
var executableLauncher = require('../app/executable-launcher')

var endoscope = require('@yoda/endoscope')
var appLaunchDurationHistogram = new endoscope.Histogram('yodaos:runtime:app_launch_duration', [ 'type', 'mode', 'appId' ])
var appSuspendDurationHistogram = new endoscope.Histogram('yodaos:runtime:app_suspend_duration', [ 'appId', 'force', 'gcore' ])
var appNotRespondingCounter = new endoscope.Counter('yodaos:runtime:app_not_responding', [ 'appId', 'pid' ])

module.exports = AppScheduler
function AppScheduler (runtime) {
  this.runtime = runtime
  this.loader = runtime.component.appLoader

  this.pidAppIdMap = {}
  this.appMap = {}
  this.appStatus = {}
  this.appLaunchOptions = {}

  this.appCreationFutures = {}
  this.__appSuspensionResolvers = {}
  this.appSuspensionFutures = {}

  this.anrSentinelTimer = null
}

AppScheduler.prototype.init = function init () {
  this.anrSentinelTimer = setInterval(this.anrSentinel.bind(this), 5 * 1000)
}

AppScheduler.prototype.deinit = function deinit () {
  clearInterval(this.anrSentinelTimer)
  this.anrSentinelTimer = null
}

AppScheduler.prototype.isAppRunning = function isAppRunning (appId) {
  return this.appStatus[appId] === Constants.status.running
}

AppScheduler.prototype.getAppById = function getAppById (appId) {
  return this.appMap[appId]
}

AppScheduler.prototype.getAppStatusById = function getAppStatusById (appId) {
  return this.appStatus[appId] || Constants.status.notRunning
}

AppScheduler.prototype.getAppStat = function getAppStat (appId) {
  return _.get(this.appMap[appId], 'stat')
}

/**
 *
 * @param {string} appId -
 * @param {object} metadata - app metadata
 * @param {AppBridge} bridge -
 * @param {number} mode - running mode
 * @param {object} [options]
 * @param {string} [options.descriptorPath] - api descriptor file to be used
 * @param {string[]} [options.args] - additional execution arguments to the child process
 * @param {object} [options.environs] - additional execution environs to the child process
 */
AppScheduler.prototype.appLauncher = {
  light: function (appId, metadata, appBridge, mode, options) {
    return lightLauncher(appId, metadata.appHome, appBridge)
  },
  exe: function (appId, metadata, appBridge, mode, options) {
    return executableLauncher(metadata.appHome, appBridge)
  },
  default: function (appId, metadata, appBridge, mode, options) {
    return defaultLauncher(metadata.appHome, appBridge, mode, options)
  },
  hive: function (appId, metadata, appBridge, mode, options) {
    var hiveLauncher = require('../app/hive-launcher')
    return hiveLauncher(metadata.appHome, appBridge, mode, options)
  }
}

/**
 *
 * @param {string} appId
 * @param {object} [options]
 * @param {string | number} [options.mode] - app launch mode
 * @param {'light' | 'exe' | 'hive' | 'default'} [options.type] - app type to be used
 * @param {string} [options.descriptorPath] - api descriptor file to be used
 * @param {string[]} [options.args] - additional execution arguments to the child process
 * @param {object} [options.environs] - additional execution environs to the child process
 * @param {boolean} [options.daemon] - daemonize app process
 */
AppScheduler.prototype.createApp = function createApp (appId, options) {
  if (this.isAppRunning(appId)) {
    return Promise.resolve(this.getAppById(appId))
  }
  var future
  switch (this.appStatus[appId]) {
    case Constants.status.creating:
      future = this.appCreationFutures[appId]
      if (future == null) {
        return Promise.reject(new Error(`Scheduler is creating app ${appId}.`))
      }
      return future
    case Constants.status.suspending:
      future = this.appSuspensionFutures[appId]
      if (future == null) {
        return Promise.reject(new Error(`Scheduler is suspending app ${appId}.`))
      }
      return future.then(() => this.createApp(appId, options))
    case Constants.status.error:
      future = this.suspendApp(appId, { force: true })
      return future.then(() => this.createApp(appId, options))
  }
  this.appStatus[appId] = Constants.status.creating

  var metadata = this.loader.getAppManifest(appId)

  var mode = _.get(options, 'mode')
  var type = _.get(options, 'type', this.loader.getTypeOfApp(appId))
  var args = _.get(options, 'args')
  var environs = _.get(options, 'environs')
  var daemon = _.get(options, 'daemon', metadata && metadata.daemon)

  if (typeof mode !== 'number') {
    mode = Constants.modes[mode]
  }
  if (mode == null) {
    mode = Constants.modes.default
  }

  var launcher = this.appLauncher[type]
  if (launcher == null) {
    launcher = this.appLauncher.default
    type = 'default'
  }
  this.appLaunchOptions[appId] = { type: type, mode: mode, args: args, environs: environs, daemon: daemon }

  var slice = appLaunchDurationHistogram.start({ type: type, mode: mode, appId: appId })

  var appBridge = new AppBridge(this.runtime, appId, metadata)
  this.appMap[appId] = appBridge
  appBridge.onExit = () => {
    if (this.appMap[appId] !== appBridge) {
      logger.info(`Not matched app on exiting, skip unset executor.app(${appId})`)
      return
    }
    this.handleAppExit(appId)
  }
  var readyPromise = new Promise((resolve, reject) => {
    appBridge.onReady = (err) => {
      if (err) {
        logger.error(`Unexpected error on initializing ${type} app(${appId})`, err.stack)
        reject(err)
        return
      }
      this.appStatus[appId] = Constants.status.running
      appBridge.emit('activity', 'created')
      resolve()
    }
  })
  var launchPromise = Promise.resolve()
    .then(() => launcher.call(this, appId, metadata, appBridge, mode, options))
    .then(pid => {
      if (pid != null) {
        this.pidAppIdMap[pid] = appId
        appBridge.pid = pid
      }
      logger.info(`App(${appId}) launched`)
      this.appMap[appId] = appBridge
    })

  future = Promise.all([ readyPromise, launchPromise ])
    .then(
      () => {
        delete this.appCreationFutures[appId]
        appLaunchDurationHistogram.end(slice)
        return appBridge
      },
      err => {
        delete this.appCreationFutures[appId]
        logger.error(`Unexpected error on launching ${type} app(${appId})`, err.stack)
        this.suspendApp(appId, { force: true })
        throw err
      })
  this.appCreationFutures[appId] = future
  return future
}

/**
 *
 * @private
 * @param {string} appId
 */
AppScheduler.prototype.handleAppExit = function handleAppExit (appId) {
  logger.info(`${appId} exited.`)
  /** incase bridge has not been marked as suspended */
  var app = this.appMap[appId]
  var appLaunchOptions = this.appLaunchOptions[appId]
  if (app) {
    app.suspend()
    delete this.pidAppIdMap[app.pid]
  }
  this.appStatus[appId] = Constants.status.exited
  this.runtime.appDidExit(appId)

  delete this.appMap[appId]
  delete this.appLaunchOptions[appId]

  var suspensionResolver = this.__appSuspensionResolvers[appId]
  if (typeof suspensionResolver === 'function') {
    suspensionResolver()
  }
  delete this.__appSuspensionResolvers[appId]

  if (appLaunchOptions.daemon) {
    logger.warn(`Restarting daemon app(${appId}) in 5s`)
    setTimeout(() => {
      this.createApp(appId)
    }, 5 * 1000)
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 */
AppScheduler.prototype.suspendAllApps = function suspendAllApps (options) {
  var aliveAppIds = Object.keys(this.appMap)
  return Promise.all(aliveAppIds.map(id => this.suspendApp(id, options)))
}

/**
 * @param {string} appId
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 * @param {boolean} [options.gcore=false]
 */
AppScheduler.prototype.suspendApp = function suspendApp (appId, options) {
  var force = _.get(options, 'force', false)
  var gcore = _.get(options, 'gcore', false)

  var launchOptions = this.appLaunchOptions[appId]
  if (launchOptions == null) {
    return Promise.resolve()
  }
  var appType = launchOptions.type
  logger.info(`suspending ${appType}-app(${appId}), force?`, force, 'gcore?', gcore)

  if (appType === 'light') {
    return Promise.resolve()
  }

  if (this.appStatus[appId] === Constants.status.suspending) {
    return Promise.resolve()
  }

  var bridge = this.appMap[appId]
  var future = Promise.resolve()
  if (bridge) {
    bridge.emit('activity', 'destroyed')
    var slice = appSuspendDurationHistogram.start({ appId: appId, force: force, gcore: gcore })
    this.appStatus[appId] = Constants.status.suspending
    future = this.appSuspensionFutures[appId] = new Promise((resolve, reject) => {
      var timer = setTimeout(() => {
        if (timer == null) {
          return
        }
        timer = null
        this.appStatus[appId] = Constants.status.error
        reject(new Error(`Suspend app(${appId}) timed out`))
      }, 5000)
      this.__appSuspensionResolvers[appId] = () => {
        if (timer == null) {
          return
        }
        clearTimeout(timer)
        timer = null
        resolve()
        appSuspendDurationHistogram.end(slice)
      }
      bridge.suspend({ force: force, gcore: gcore })
    })
  }

  return future
}

AppScheduler.prototype.anrSentinel = function anrSentinel () {
  var now = system.clockGetTime(system.CLOCK_MONOTONIC).sec
  return Promise.all(
    Object.keys(this.appMap)
      .map(appId => {
        var bridge = this.appMap[appId]
        var lastReportTimestamp = bridge.lastReportTimestamp
        if (isNaN(lastReportTimestamp)) {
          return
        }
        var delta = now - lastReportTimestamp
        if (delta < 15 /** 15s */) {
          return
        }
        logger.warn(`ANR: app(${appId}) has not been reported alive for ${delta}s.`)
        appNotRespondingCounter.inc({ appId: appId, pid: bridge.pid })
        return this.suspendApp(appId, { gcore: true })
      })
  )
}
