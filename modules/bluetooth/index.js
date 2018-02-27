'use strict';

const property = require('@rokid/property');
const context = require('@rokid/context');
const logger = require('@rokid/logger')('bluetooth');
const BluetoothWrap = require('bindings')('bluetooth').BluetoothWrap;
const handle = new BluetoothWrap();

let ble_is_opened = false;
let a2dp_is_opened = false;

const id = property.serialno ? property.serialno.slice(-6) : 'xxxxxx';
const name = context.deviceConfig.namePrefix + id;

/**
 * @method open
 * @param {String} name - the bluetooth name
 */
exports.open = function open() {
  if (ble_is_opened === true)
    ble.close();
  handle.open(name);
  a2dp_is_opened = true;
};

/**
 * @method close
 */
exports.close = function close() {
  handle.close();
  a2dp_is_opened = false;
};

/**
 * @method play
 */
exports.play = function play() {
  if (a2dp_is_opened)
    handle.sendCommand(0);
};


/**
 * @method stop
 */
exports.stop = function stop() {
  if (a2dp_is_opened)
    handle.sendCommand(1);
};

/**
 * @method pause
 */
exports.pause = function pause() {
  if (a2dp_is_opened)
    handle.sendCommand(2);
};

/**
 * @method playNext
 */
exports.playNext = function playNext() {
  if (a2dp_is_opened)
    handle.sendCommand(3);
};

/**
 * @method playPrev
 */
exports.playPrev = function playPrev() {
  if (a2dp_is_opened)
    handle.sendCommand(4);
};

/**
 * @method a2dp
 * @param {String} type - sink or link
 */
exports.a2dp = function a2dp(type) {
  if (type === 'sink')
    return handle.enableA2DPSink();
  else if (type === 'link')
    return handle.enableA2DPLink();
  else
    return handle.enableA2DP();
};

/**
 * @class BluetoothLowEnergy
 */
class BluetoothLowEnergy {
  /**
   * @method open
   */
  open() {
    if (a2dp_is_opened === true)
      close();
    handle.enableBLE(name);
    ble_is_opened = true;
    return this;
  }
  /**
   * @method close
   */
  close() {
    handle.disableBLE();
    ble_is_opened = false;
  }
  /**
   * @method onResp
   * @param {Function} callback
   */
  onResp(callback) {
    if (typeof callback !== 'function')
      throw new TypeError('function is required');
    this.getHeader((_, size) => {
      this.getResp('', size, (err, data) => {
        callback(err, data);
      });
    });
  }
  /**
   * @method getHeader
   * @param {Function} callback
   */
  getHeader(callback) {
    handle.getBleResp((err, data) => {
      if (err)
        return callback(err);

      const headm = data.match(/^size:(\d+)/);
      const size = headm ? parseInt(headm[1]) : 0;
      callback(null, size);
    });
  }
  /**
   * @method getResp
   * @param {String} concated the concated string
   * @param {Function} callback
   */
  getResp(concated, size, callback) {
    if (!size)
      return callback(null, concated);

    let done = false;
    handle.getBleResp((err, data) => {
      if (err)
        return callback(err);

      logger.log(`>>> ${data} <<<`);
      const buf = new Buffer(data || '');
      let endPos = buf.length;
      for (let i = 0; i < buf.length; i++) {
        // <ef bf bd> is for unknown chars, cut with this.
        if (buf[i] === 0xef &&
          buf[i+1] === 0xbf &&
          buf[i+2] === 0xbd) {
          endPos = i;
          // done = true;
          break;
        }
      }
      concated += buf.slice(0, endPos).toString();
      return this.getResp(concated, size - 1, callback);
    });
  }
  /**
   * @method write
   * @param {String} data
   */
  write(data) {
    handle.sendBleResp(data);
  }
}

// we use a globally BLE instance
let ble = new BluetoothLowEnergy();

/**
 * @method ble
 * @param {String} name - the BLE name
 */
exports.ble = function(name) {
  if (ble_is_opened === true)
    ble.close();
  return ble.open(name);
};
