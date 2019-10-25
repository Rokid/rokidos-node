var _ = require('@yoda/util')._
var Logger = require('logger')
var system = require('@yoda/system')

class BridgeError extends Error {
  constructor (message) {
    super(message)
    this.name = 'BridgeError'
  }
}

class AppBridge {
  constructor (runtime, appId, metadata) {
    this.runtime = runtime
    this.appId = appId
    this.metadata = metadata
    this.logger = Logger(`bridge-${appId}`)

    // Bridging
    this.subscriptionTable = {}

    // States
    this.suspended = false
    this.exited = false
    this.ready = false
    this.lastReportTimestamp = NaN
    this.stat = { idleAt: Date.now() }

    // Implementation
    this.exitInl = null
  }

  emit (namespace, name, args) {
    namespace = namespace || 'activity'
    var eventStr = `${namespace}.${name}`
    var listener = this.subscriptionTable[eventStr]
    if (typeof listener === 'function') {
      this.stat.idleAt = Date.now()
      listener.apply(global, args)
    }
  }

  subscribe (namespace, name, listener) {
    namespace = namespace || 'activity'
    var eventStr = `${namespace}.${name}`
    this.logger.debug(`Received subscription: ${eventStr}`)
    if (this.subscriptionTable[eventStr]) {
      this.logger.debug(`Event '${eventStr}' has already been subscribed, skipping.`)
      return
    }
    this.stat.idleAt = Date.now()

    this.subscriptionTable[eventStr] = listener
  }

  invoke (namespace, method, params) {
    namespace = namespace || 'activity'
    var methodStr = `${namespace}.${method}`

    var descriptor = this.runtime.descriptor[namespace]
    if (descriptor == null) {
      return Promise.reject(new BridgeError(`Unknown namespace '${namespace}' been invoked`))
    }
    var fn = descriptor[method]
    if (typeof fn !== 'function') {
      return Promise.reject(new BridgeError(`Unknown method '${methodStr}' been invoked`))
    }
    this.stat.idleAt = Date.now()
    // TODO: metadata check
    return Promise.resolve().then(() => fn.call(descriptor, this.getContext({ args: params })))
      .catch(e => {
        console.error(`Unexpected error on invoke '${methodStr}': ${e.stack}`)
        throw e
      })
  }

  getContext (fields) {
    return Object.assign({}, fields, {
      appId: this.appId
    }, this.metadata)
  }

  // MARK: - Status Reports
  didReady (err) {
    if (this.ready) {
      this.logger.warn(`app(${this.appId}) might have been ready for multiple times.`)
      return
    }
    this.ready = true
    this.onReady(err)
  }

  refreshAnr () {
    this.lastReportTimestamp = system.clockGetTime(system.CLOCK_MONOTONIC).sec
  }

  // MARK: - APIs for scheduler
  suspend (options) {
    var force = _.get(options, 'force', false)
    var gcore = _.get(options, 'gcore', false)
    if (this.suspended && !force) {
      return
    }
    this.suspended = true
    if (this.exited) {
      return
    }
    this.exitInl && this.exitInl(force, gcore)
  }

  statusReport (status) {
    switch (status) {
      case 'ready':
        this.didReady()
        this.refreshAnr()
        break
      case 'alive':
        this.refreshAnr()
        break
    }
  }

  onExit (code, signal) {}
  // eslint-disable-next-line handle-callback-err
  onReady (err) {}

  // MARK: - APIs for implementor
  implement (inl) {
    if (typeof inl !== 'object') {
      return
    }
    this.exitInl = inl.exit
    if (inl.anrEnabled) {
      this.refreshAnr()
    } else {
      /** for launchers doesn't need anr timer */
      this.didReady()
    }
  }

  didExit () {
    if (this.exited) {
      this.logger.warn(`app(${this.appId}) might have been exited multiple times.`)
      return
    }
    this.exited = true
    if (!this.ready) {
      this.didReady(new Error(`app(${this.appId}) exited before ready`))
    }
    this.onExit()
  }
}

module.exports = AppBridge
