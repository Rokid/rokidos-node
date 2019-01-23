'use strict'

var Directive = require('./directive').Directive
var PlayerManager = require('./playerManager')
var TtsEventHandle = require('@yodaos/ttskit').Convergence
var MediaEventHandle = require('@yodaos/mediakit').Convergence
var logger = require('logger')('cloudAppClient')
var Skill = require('./skill')
var _ = require('@yoda/util')._

var Manager = require('./manager')
var Service = require('./service')

// identify if the skill should be to restored
var needResume = false

module.exports = activity => {
  // create an extapp
  var directive = new Directive()
  // playerId manager version 1
  var pm = new PlayerManager()
  // skill os
  var sos = new Manager(directive, Skill)
  // tts, media event handle
  var ttsClient = new TtsEventHandle(activity.tts)
  var mediaClient = new MediaEventHandle(activity.media, logger)

  // service
  var service = new Service({
    activity: activity,
    skillMgr: sos,
    playerMgr: pm,
    ttsClient: ttsClient
  })
  service.start()

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
  sos.on('exit', (skill) => {
    var playerId = pm.getByAppId(skill.appId)
    if (playerId) {
      pm.deleteByAppId(skill.appId)
      activity.media.stop(playerId)
        .then(() => {
          logger.log(`${skill.appId}: media have been destroyed`)
        })
        .catch((err) => {
          logger.log(`${skill.appId}: an error occur when destroy media ${err}`)
        })
    }
  })

  pm.on('change', (appId, playerId) => {
    logger.log(`playerId was changed from appId(${appId}) playerId(${playerId})`)
    activity.media.stop(playerId)
      .then(() => {
        logger.log(`[pm](media, stop) appId(${appId}) res(success)`)
      })
      .catch((err) => {
        logger.log(`[pm](media, stop) appId(${appId}) err: ${err}`)
      })
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
        })
        .catch((err) => {
          logger.log(`end dt: tts.${dt.action} ${err}`)
        })
      next()
    }
  })
  directive.do('frontend', 'media', function (dt, next) {
    var playerId
    logger.log(`exe dt: media.${dt.action}`)
    function setSpeed (speed) {
      if (typeof speed === 'number') {
        activity.media.setSpeed(speed, pm.getByAppId(dt.data.appId))
      }
    }
    function setOffset (offset) {
      if (typeof offset === 'number' && offset >= 0) {
        activity.media.seek(offset, pm.getByAppId(dt.data.appId))
      }
    }
    if (dt.action === 'play') {
      if (mediaClient.getUrl() === dt.data.item.url) {
        logger.log(`play forward offset: ${dt.data.item.offsetInMilliseconds} mutiple: ${dt.data.item.playMultiple}`)
        setSpeed(dt.data.item.playMultiple)
        if (dt.data.item.offsetInMilliseconds > 0) {
          setOffset(dt.data.item.offsetInMilliseconds)
        }
        activity.media.resume(pm.getByAppId(dt.data.appId))
      } else {
        mediaClient.start(dt.data.item.url, { multiple: true }, function (name, args) {
          logger.log(`[cac-event](${name}) args(${JSON.stringify(args)}) `)
          if (name === 'resolved') {
            pm.setByAppId(dt.data.appId, args)
          } else if (name === 'prepared') {
            setSpeed(dt.data.item.playMultiple)
            setOffset(dt.data.item.offsetInMilliseconds)
            sos.sendEventRequest('media', 'prepared', dt.data, {
              itemId: _.get(dt, 'data.item.itemId'),
              duration: args[0],
              progress: args[1]
            })
          } else if (name === 'paused') {
            sos.sendEventRequest('media', 'paused', dt.data, {
              itemId: _.get(dt, 'data.item.itemId'),
              duration: args[0],
              progress: args[1]
            })
          } else if (name === 'resumed') {
            sos.sendEventRequest('media', 'resumed', dt.data, {
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
      }
    } else if (dt.action === 'pause') {
      // no need to send events here because player will emit paused event
      activity.media.pause(pm.getByAppId(dt.data.appId))
        .then(() => {
          logger.log(`[cac-dt](media, pause) res(success)`)
        })
        .catch((err) => {
          logger.log(`[cac-dt](media, pause) err: ${err}`)
        })
      next()
    } else if (dt.action === 'resume') {
      // no need to send events here because player will emit resumed event
      activity.media.resume(pm.getByAppId(dt.data.appId))
        .then(() => {
          logger.log(`[cac-dt](media, resume) res(success)`)
          next()
        })
        .catch((err) => {
          logger.log(`[cac-dt](media, resume) err: ${err}`)
        })
    } else if (dt.action === 'cancel') {
      playerId = pm.getByAppId(dt.data.appId)
      if (playerId) {
        pm.deleteByAppId(dt.data.appId)
        activity.media.stop(playerId)
          .then(() => {
            sos.sendEventRequest('media', 'cancel', dt.data, {
              itemId: _.get(dt, 'data.item.itemId'),
              token: _.get(dt, 'data.item.token')
            })
          })
          .catch((err) => {
            logger.log('media stop failed', err)
          })
      }
      next()
    } else if (dt.action === 'stop') {
      playerId = pm.getByAppId(dt.data.appId)
      if (playerId) {
        pm.deleteByAppId(dt.data.appId)
        activity.media.stop(playerId)
          .then(() => {
            logger.log('media stop success')
          })
          .catch((err) => {
            logger.log('media stop failed', err)
          })
      }
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
    var index = needSaveData()
    if (index >= 0) {
      activity.media.getPosition().then(progress => {
        logger.log('progress =', progress)
        if (sos && sos.skills[index]) {
          sos.skills[index].setProgress(progress)
          sos.skills[index].saveRecoverData(activity)
          sos.destroy()
        }
      })
    } else {
      sos.destroy()
    }
  })
  activity.on('notification', (state) => {
    switch (state) {
      case 'on-start-shake':
        logger.log('on-start-shake')
        break
      case 'on-stop-shake':
        logger.log('on-stop-shake')
        activity.voiceCommand('下一首')
        break
      case 'on-quite-back':
        logger.log('on-quite-back')
        sos.setManualPauseFLag(true)
        sos.pause()
        break
      case 'on-quite-front':
        logger.log('on-quite-front')
        sos.setManualPauseFLag(false)
        sos.resume()
        break
    }
  })
  activity.on('url', urlObj => {
    logger.log('url is', typeof (urlObj), urlObj)
    switch (urlObj.pathname) {
      case '/resume':
        logger.log('action = ', urlObj.query.data)
        var resObj = genAction(JSON.parse(urlObj.query.data))
        logger.log('resObj = ', resObj)
        activity.setContextSkillId(resObj.appId)
        sos.onrequest(null, resObj)

        for (var i = 0; i < sos.skills.length; i++) {
          logger.log('skills = ', sos.skills[i].hasPlayer, sos.skills[i].form, sos.skills[i].saveRecoverData)
          if (sos.skills[i].hasPlayer && sos.skills[i].form === 'scene') {
            sos.skills[i].setplayerCtlData(resObj.response.action.directives[0])
          }
        }

        break
      default:
        break
    }
  })
  function genAction (data) {
    var dts = [
    ]
    dts.push(data)
    var actionobj = {
      form: 'scene',
      shouldEndSession: false,
      directives: dts
    }
    var resobj = {
      action: actionobj
    }
    var action = {
      startWithActiveWord: false,
      appId: data.appId,
      response: resobj

    }
    return action
  }
  function needSaveData () {
    var index = -1
    for (var i = 0; i < sos.skills.length; i++) {
      logger.log('skills = ', sos.skills[i].hasPlayer, sos.skills[i].form, sos.skills[i].saveRecoverData, i)
      if (sos.skills[i].hasPlayer && sos.skills[i].form === 'scene') {
        index = i
      }
    }
    return index
  }
}
