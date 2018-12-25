'use strict'

var logger = require('logger')('readInfo.test')
var test = require('tape')
var fs = require('fs')

var ota = require('@yoda/ota')
var upgradeDir = require('./mock').upgradeDir

var infoFile = upgradeDir + '/info.json'
var info = {imageUrl: '/test/test',
  authorize: '',
  changelog: 'yyyyyy',
  checksum: 'cbdakbcabcka',
  isForceUpdate: false,
  version: '111111',
  imagePath: '/data/yc/test',
  status: 'downloaded'
}

test('Info should be null,if info.json is not existed', t => {
  t.plan(1)
  fs.writeFile(infoFile, JSON.stringify(info), () => {
    fs.unlink(infoFile, () => {
      ota.readInfo((_, info) => {
        if (info === null) {
          t.pass('info should be null')
          t.end()
        } else {
          t.fail('there is a error ,the info.json is fail to delete')
          t.end()
        }
      })
    })
  })
})

test('Info should be null, if info.json is malformed json', t => {
  t.plan(2)
  fs.writeFile(infoFile, 'foobar', () => {
    ota.readInfo((err, info) => {
      t.error(err)
      t.true(info === null, 'info shall be null on malformed json')
      t.end()
    })
  })
})

test('readInfo result should not be null,if info is existed', t => {
  t.plan(2)
  // 将文件信息写入info.json
  fs.writeFile(infoFile, JSON.stringify(info), (err) => {
    if (err) {
      return t.fail(err)
    }
    logger.log('writeFile===success')
    ota.readInfo((err, info) => {
      t.assert(err === null)
      if (info !== null) {
        logger.info('======checksum:' + info.checksum)
        logger.info('======version:' + info.version)
        logger.info('======imageUrl:' + info.imageUrl)
        t.pass('info not null')
      } else {
        t.end()
      }
    })
  })
})
