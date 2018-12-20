'use strict'

var exec = require('child_process').exec
var parseDateString = require('@yoda/system').parseDateString
var logger = require('logger')('date-sync')

var TIMEZONE = 8
var DATE_FORMAT = '%A, %d %b %Y %H:%M:%S'

function sync (source) {
  return new Promise(function (resolve, reject) {
    var date = parseDateString(source, DATE_FORMAT)
    if (date.hours + TIMEZONE >= 24) {
      date.date += 1
      date.hours = date.hours + TIMEZONE - 24
    } else {
      date.hours += TIMEZONE
    }
    var str = [
      [date.year, date.month, date.date].join('-'),
      [date.hours, date.minutes, date.seconds].join(':')
    ].join(' ')

    var cmd = `date -s "${str}"`
    logger.log(`exec ${cmd} from <${source}>`)
    exec(cmd, {}, function (err, stdout, stderr) {
      if (err) {
        reject(err)
      } else {
        resolve(true)
      }
    })
  })
}
exports.sync = sync
