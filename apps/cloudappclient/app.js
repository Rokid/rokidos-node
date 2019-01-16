'use strict'

var Directive = require('./directive').Directive
var TtsEventHandle = require('@yodaos/ttskit').Convergence
var MediaEventHandle = require('@yodaos/mediakit').Convergence
var logger = require('logger')('cloudAppClient')
var Skill = require('./skill')
var _ = require('@yoda/util')._

var Manager = require('./manager')

// identify if the skill should be to restored
var needResume = false

module.exports = activity => {
  // create an extapp
  var directive = new Directive()
  // skill os
  var sos = new Manager(directive, Skill)
  // tts, media event handle
  var ttsClient = new TtsEventHandle(activity.tts)
  var mediaClient = new MediaEventHandle(activity.media)

  // report app status for OS in nextTick
  var taskTimerHandle = null

  sos.on('empty', () => {
    clearTimeout(taskTimerHandle)
    taskTimerHandle = setTimeout(() => {
      logger.log('cloudAppClient was setBackground, because there is no skill to execute')
      activity.setBackground()
      // currently no skill to execute, so don't resume
      needResume = false
    }, 0)
  })

  directive.do('frontend', 'tts', function (dt, next) {
    logger.log(`start dt: tts.${dt.action}`)
    if (dt.action === 'say') {
      ttsClient.speak(dt.data.item.tts, function (name) {
        logger.log(`end dt: tts.${dt.action} ${name}`)
        if (name === 'start') {
          sos.sendEventRequest('tts', 'start', dt.data, _.get(dt, 'data.item.itemId'))
        } else if (name === 'end') {
          sos.sendEventRequest('tts', 'end', dt.data, _.get(dt, 'data.item.itemId'), next)
        } else if (name === 'cancel' || name === 'error') {
          sos.sendEventRequest('tts', name, dt.data, _.get(dt, 'data.item.itemId'), function cancel () {
            logger.info(`end task early because tts.${name} event emit`)
            // end task early, no longer perform the following tasks
            next(true)
          })
        }
      })
    } else if (dt.action === 'cancel') {
      activity.tts.stop()
        .then(() => {
          logger.log(`end dt: tts.${dt.action}`)
          sos.sendEventRequest('tts', 'cancel', dt.data, _.get(dt, 'data.item.itemId'))
        })
        .catch((err) => {
          logger.log(`end dt: tts.${dt.action} ${err}`)
        })
      next()
    }
  })
  directive.do('frontend', 'media', function (dt, next) {
    logger.log(`exe dt: media.${dt.action}`)
    if (dt.action === 'play') {
      mediaClient.start(dt.data.item.url, function (name, args) {
        if (name === 'prepared') {
          sos.sendEventRequest('media', 'prepared', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            duration: args[0],
            progress: args[1]
          })
        } else if (name === 'playbackcomplete') {
          sos.sendEventRequest('media', 'playbackcomplete', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          }, next)
        } else if (name === 'cancel' || name === 'error') {
          sos.sendEventRequest('media', name, dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          }, function cancel () {
            logger.info(`end task early because meida.${name} event emit`)
            // end task early, no longer perform the following tasks
            next(true)
          })
        }
      })
    } else if (dt.action === 'pause') {
      activity.media.pause()
        .then(() => {
          sos.sendEventRequest('media', 'pause', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          })
        })
        .catch((err) => {
          logger.log('media pause failed', err)
        })
      next()
    } else if (dt.action === 'resume') {
      activity.media.resume()
        .then(() => {
          sos.sendEventRequest('media', 'resume', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          }, next)
        })
        .catch((err) => {
          logger.log('media resume failed', err)
        })
    } else if (dt.action === 'cancel') {
      activity.media.stop()
        .then(() => {
          sos.sendEventRequest('media', 'cancel', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          })
        })
        .catch((err) => {
          logger.log('media stop failed', err)
        })
      next()
    } else if (dt.action === 'stop') {
      activity.media.stop()
        .then(() => {
          sos.sendEventRequest('media', 'stop', dt.data, {
            itemId: _.get(dt, 'data.item.itemId'),
            token: _.get(dt, 'data.item.token')
          })
        })
        .catch((err) => {
          logger.log('media stop failed', err)
        })
      next()
    }
  })

  directive.do('frontend', 'confirm', function (dt, next) {
    activity.setPickup(true)
      .then(() => {
        logger.log('setConfirm success')
        next()
      })
      .catch((error) => {
        logger.log('setConfirm failed: ', error)
        next()
      })
  })

  directive.do('frontend', 'pickup', function (dt, next) {
    activity.setPickup(true)
      .then(() => {
        logger.log('setPickup success')
        next()
      })
      .catch(() => {
        logger.log('setPickup failed')
        next()
      })
  })

  directive.do('frontend', 'native', function (dt, next) {
    // notice: current form default value is 'cut'
    var appId = _.get(dt, 'data.packageInfo.name', '')
    var form = _.get(dt, 'data.packageInfo.form', 'cut')
    var command = dt.data.command || ''
    // Native directives should not preempt cloudAppclient
    activity.openUrl(`yoda-skill://${appId}/?command=${command}`, { form: form, preemptive: false })
      .then(() => {
        logger.log('url open success')
        next()
      })
      .catch((err) => {
        logger.log('url open failed', err)
        next()
      })
  })

  activity.on('ready', function () {
    logger.log(this.appId + ' app ready')
    logger.log('get CONFIG from OS')
    activity.get('all')
      .then((result) => {
        logger.log('get prop success')
        sos.setEventRequestConfig(result || {})
      })
      .catch((error) => {
        logger.log('get prop error', error)
      })
  })

  activity.on('error', function (err) {
    logger.log('app error: ', err)
  })

  activity.on('create', function () {
    logger.log(`${this.appId} create`)
  })

  activity.on('pause', function () {
    logger.log(this.appId + ' paused')
    needResume = true
    sos.pause()
  })

  activity.on('resume', function () {
    logger.log(this.appId + ' resumed')
    if (needResume) {
      clearTimeout(taskTimerHandle)
      needResume = false
      sos.resume()
    }
  })
  // active event will emit when resetAwaken
  activity.on('active', function () {
    logger.log(`${this.appId} actived`)
    if (needResume) {
      clearTimeout(taskTimerHandle)
      needResume = false
      sos.resume()
    }
  })

  activity.on('request', function (nlp, action) {
    var intentType = _.get(action, 'response.action.type')
    if (!intentType) {
      logger.error(`The content of the action is wrong! The actual value is: [${action}]`)
      if (sos.skills.length === 0) {
        logger.log('there is no skill to run, setBackground because action error!')
        activity.setBackground()
      } else {
        sos.resume()
      }
      return
    }
    var appId = _.get(nlp, 'appId')
    if (appId && intentType === 'EXIT') {
      logger.warn(`The intent value is [EXIT] with appId: [${appId}]`)
      sos.destroyByAppId(appId)
      return
    }
    if (intentType === 'EXIT') {
      logger.warn(`${this.appId}: intent value is [EXIT]`)
      sos.destroy()
      activity.setBackground()
      return
    }
    logger.log(`${this.appId} app request`)
    clearTimeout(taskTimerHandle)
    sos.onrequest(nlp, action)
  })

  activity.on('destroy', function () {
    logger.log(this.appId + ' destroyed')
    sos.destroy()
  })
}
