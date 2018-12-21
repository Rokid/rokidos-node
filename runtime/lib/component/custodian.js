var logger = require('logger')('custodian')
var property = require('@yoda/property')
var wifi = require('@yoda/wifi')
var _ = require('@yoda/util')._

module.exports = Custodian
function Custodian (runtime) {
  wifi.enableScanPassively()
  this.runtime = runtime

  /**
   * set this._networkConnected = undefined at initial to
   * prevent discarding of very first of network disconnect event.
   */
  this._networkConnected = undefined
  /**
   * this._checkingNetwork sets the current network is checking,
   * it should be checked at onNetworkConnect, when it doesn't get
   * down.
   */
  this._checkingNetwork = false
  /**
   * this._loggedIn could be used to determine if current session
   * is once connected to internet.
   */
  this._loggedIn = false
}

/**
 * Fires when the network is connected.
 * @private
 */
Custodian.prototype.onNetworkConnect = function onNetworkConnect () {
  if (this._networkConnected || this._checkingNetwork) {
    return
  }
  property.set('state.network.connected', 'true')

  this._networkConnected = true
  logger.info('on network connect and checking internet connection.')

  // start checking the internet connection
  this._checkingNetwork = true
  wifi.checkNetwork(10 * 1000, (err, connected) => {
    this._checkingNetwork = false
    if (err || !connected) {
      logger.error('check: failed to get connected on the current wifi.')
      this.onNetworkDisconnect()
      return
    }
    logger.info('check: dns is working and start login / bind.')
    this.runtime.reconnect()
  })

  if (this.runtime.scheduler) {
    var appMap = this.runtime.scheduler.appMap
    Object.keys(appMap).forEach(key => {
      var activity = appMap[key]
      activity.emit('internal:network-connected')
    })
  }
}

/**
 * Fires when the network is disconnected.
 * @private
 */
Custodian.prototype.onNetworkDisconnect = function onNetworkDisconnect () {
  if (this._networkConnected === false) {
    return
  }
  property.set('state.network.connected', 'false')
  this._networkConnected = false
  logger.info('on network disconnect, once logged in?', this._loggedIn)

  if (this.isConfiguringNetwork()) {
    logger.info('current is configuring network, just skip the disconnect open')
    return
  }

  if (wifi.getNumOfHistory() > 0) {
    logger.log('network switch, try to reconnect, waiting for user awake or button event')
    wifi.enableScanPassively()
    return
  }

  /**
   * If no history found, we should reset network state and goto network automatically.
   */
  logger.log('network disconnected and no history found')
  logger.log('reset network and goto network to config')
  this.runtime.resetNetwork({ removeAll: true }).then(() => {
    this.runtime.openUrl('yoda-skill://network/setup', { preemptive: true })
  })
}

Custodian.prototype.onLoggedIn = function onLoggedIn () {
  this._loggedIn = true
  property.set('state.rokid.logged', 'true')
  logger.info('on logged in')
}

Custodian.prototype.onLogout = function onLogout () {
  this._loggedIn = false
  this.runtime.wormhole.setOffline()
  property.set('state.rokid.logged', 'false')
  // reset the onGetPropAll...
  this.runtime.onGetPropAll = function () {
    return {}
  }
  logger.info('on logged out and clear the onGetPropAll state')
}

/**
 * Reset network and start procedure of configuring network.
 *
 * @param {object} [options] -
 * @param {boolean} [options.removeAll] - remove local wifi config?
 */
Custodian.prototype.resetNetwork = function resetNetwork (options) {
  logger.log('reset network')
  var removeAll = _.get(options, 'removeAll')
  wifi.resetWifi()
  if (removeAll) {
    wifi.removeAll()
  } else {
    wifi.disableAll()
  }
  property.set('state.network.connected', 'false')

  this._networkConnected = false
  return this.runtime.openUrl('yoda-skill://network/setup', { preemptive: true })
}

/**
 * Determines network is connected also runtime was logged in.
 */
Custodian.prototype.isPrepared = function isPrepared () {
  return this._networkConnected && this._loggedIn
}

/**
 * Determines if network is unavailable.
 */
Custodian.prototype.isNetworkUnavailable = function isNetworkUnavailable () {
  return !this._networkConnected
}

/**
 * Determines network is connected yet runtime is registering with Rokid services.
 */
Custodian.prototype.isRegistering = function isRegistering () {
  return this._networkConnected && !this._loggedIn
}

/**
 * Determines runtime is once logged in and has not been reset.
 */
Custodian.prototype.isLoggedIn = function isLoggedIn () {
  return this._loggedIn
}

/**
 * Determines if network configuring app is currently active app.
 */
Custodian.prototype.isConfiguringNetwork = function isConfiguringNetwork () {
  return this.runtime.life.getCurrentAppId() === '@yoda/network'
}

Custodian.prototype.prepareNetwork = function prepareNetwork () {
  if (wifi.getWifiState() === wifi.WIFI_CONNECTED) {
    return this.onNetworkConnect()
  }
  if (wifi.getNumOfHistory() > 0) {
    logger.info('has histroy wifi, just skip')
    return
  }
  return this.onNetworkDisconnect()
}
