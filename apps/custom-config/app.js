var _ = require('@yoda/util')._
var safeParse = require('@yoda/util').json.safeParse
var logger = require('logger')('custom-config')
var WakeupEffect = require('./wakeup-effect')
var StandbyLight = require('./standby-light')
var ContinuousDialog = require('./continuous-dialog')
var VtWord = require('./vt-word')

module.exports = function CustomConfig (activity) {
  var intentMap = {}
  var urlMap = {}
  var processorList = []
  processorList.push(new StandbyLight(activity))
  processorList.push(new WakeupEffect(activity))
  processorList.push(new ContinuousDialog(activity))
  processorList.push(new VtWord(activity))
  for (var i = 0; i < processorList.length; ++i) {
    Object.assign(intentMap, processorList[i].getIntentMap())
    Object.assign(urlMap, processorList[i].getUrlMap())
  }
  activity.on('ready', onReady)
  activity.on('request', onRequest)
  activity.on('url', onUrl)

  /**
   * skill url was requested
   * @param {object} urlObj - skill url
   */
  function onUrl (urlObj) {
    var queryObj = urlObj.query
    var path = ''
    if (urlObj.pathname && urlObj.pathname.length > 0) {
      path = urlObj.pathname.substr(1)
    }
    logger.info(`on Url---->is called [${path}]`)
    if (path === 'firstLoad') {
      var customConfig = safeParse(queryObj.config)
      if (customConfig && typeof customConfig === 'object') {
        for (var field in customConfig) {
          if (customConfig.hasOwnProperty(field) && urlMap.hasOwnProperty(field)) {
            urlMap[field](safeParse(customConfig[field]))
          }
        }
      }
    } else {
      var func = urlMap[path]
      if (func) {
        func(queryObj)
      } else {
        logger.warn(`skill url [${path}] is not hit`)
      }
    }
  }

  /**
   * activity is ready
   */
  function onReady () {
    activity.get().then(config => {
      for (var i = 0; i < processorList.length; ++i) {
        processorList[i].ready(config)
      }
    })
  }

  /**
   * intent request
   * @param {string} nlp - request nlp
   * @param {string} action - request action
   */
  function onRequest (nlp, action) {
    var intent = nlp.intent
    var actionValue = _.get(nlp, 'slots.open.type') || _.get(nlp, 'slots.close.type')
    logger.info(`request---->intent: ${intent};   action:  + ${actionValue}`)
    var func = intentMap[intent]
    if (func) {
      func(actionValue)
    } else {
      logger.warn(`intent [${intent}] is not hit`)
    }
  }
}
