'use strict'

var logger = require('logger')('apps/battery')
var battery = require('./battery')
var ContextManager = require('@yodaos/application/context-manager')

var TEMPERATURE_LIGHT_RES = 'system://temperatureBattery.js'
var CONSTANT = require('./constant.json').constant

module.exports = function (activity) {
  var contextMgr = new ContextManager(activity)
  activity.media.on('error', err => logger.warn(err))

  function notifyMedia (url, callback) {
    logger.log('notify media will setForeground:', url)
    activity.media.start(url, { impatient: false })
      .then(() => {
        if (typeof (callback) === 'function') {
          callback()
          return
        }
        logger.log('notify media callback will exit:', url)
        this.exit()
      })
      .catch(error => {
        logger.warn(error)
      })
  }

  function notifyTTS (text) {
    if (text === false) {
      return this.exit()
    }
    logger.log('notifyTTS', text)
    activity.tts.speak(text)
      .then(() => {
        logger.log('notify tts callback will exit:', text)
        this.exit()
      })
      .catch(error => {
        logger.error(error)
      })
  }

  function powerStatusChange (isOnline, isPlaying, testPercent) {
    var sound = isOnline ? 'system://power_plug.ogg' : 'system://power_pull.ogg'
    activity.playSound(sound).then(() => {
      return battery.onPowerStatusChanged(isOnline, isPlaying, testPercent)
    }).then(notifyTTS.bind(this))
  }

  function pushNotification () {
    var date = new Date()
    var h = date.getHours()
    var content
    if (h >= 22 || h <= 7) {
      content = CONSTANT.notificationNight
    } else {
      var seed = Math.random()
      logger.error(seed, seed > 0.5 ? CONSTANT.notification1 : CONSTANT.notification2)
      content = seed > 0.5 ? CONSTANT.notification1 : CONSTANT.notification2
    }
    var body = {
      'message': content,
      'extra': '{"sys":{}}'
    }
    var bodyStr = JSON.stringify(body)
    logger.log(`pushNotification: ${bodyStr}`)
    activity.httpgw.request(CONSTANT.urls.PUSH_MOBILE_MSG, body, { services: 'rest' })
      .then((res) => {
        logger.log('pushNotification result:', bodyStr, res)
      })
  }

  contextMgr.on('request', function (context) {
    var intent = context.nlp.intent
    logger.log('battery_intent:', intent)
    switch (intent) {
      case 'battery_usetime':
        battery.getUseTime().then(notifyTTS.bind(context))
        break
      case 'battery_charging':
        battery.isCharging().then(notifyTTS.bind(context))
        break
      case 'battery_level':
        battery.getLevel().then(notifyTTS.bind(context))
        break
      default:
        logger.warn('unsupported intent:', intent)
    }
  })

  contextMgr.on('url', function handleUrl (context) {
    var url = context.urlObj
    if (!url || !url.pathname) {
      logger.warn('url object is invalid')
      return
    }
    switch (url.pathname) {
      case '/power_on':
        powerStatusChange.call(context, true)
        break
      case '/power_off':
        powerStatusChange.call(context, false,
          url.query && url.query.is_play,
          url.query && url.query.is_test && url.query.test_percent)
        break
      case '/low_power_20':
        battery.lowerPower(20, url.query && url.query.is_play).then(notifyMedia.bind(context))
        break
      case '/low_power_10':
        battery.lowerPower(10, url.query && url.query.is_play).then(notifyMedia.bind(context))
        break
      case '/low_power_8':
        logger.error('random:', Math.random())
        pushNotification.call(context)
        break
      case '/temperature_55':
        battery.temperatureAbnormal(true).then(notifyMedia.bind(context))
        break
      case '/temperature_0':
        battery.temperatureAbnormal(false).then(notifyMedia.bind(context))
        break
      case '/temperature_light_55':
        logger.warn('temperatureAbnormalLight: true')
        activity.light.play(TEMPERATURE_LIGHT_RES)
        battery.pollingCheckTemperature(function onBatteryException (data) {
          activity.light.play(TEMPERATURE_LIGHT_RES)
        })
        break
      case '/temperature_light_0':
        logger.warn('temperatureAbnormalLight: false')
        activity.light.play(TEMPERATURE_LIGHT_RES)
        battery.pollingCheckTemperature(function onBatteryException (data) {
          activity.light.play(TEMPERATURE_LIGHT_RES)
        })
        break
      case '/test_batlevel':
        battery.getLevel().then(notifyTTS)
        break
      case '/test_use_time':
        battery.getUseTime().then(notifyTTS)
        break
      case '/test_time_full':
        var isCharingError = url.query && url.query.is_charging_error
        battery.isCharging(isCharingError).then(notifyTTS)
        break
      default:
        logger.warn('without this path:', url.pathname)
    }
  })
}
