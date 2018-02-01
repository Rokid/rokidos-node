'use strict';

const fs = require('fs');
const EventEmitter = require('events').EventEmitter;

let config;
let deviceConfig;
let keyEventPlugin;
let voiceEventPlugin;

if (fs.existsSync('/data/system/openvoice_profile.json')) {
  config = JSON.parse(fs.readFileSync('/data/system/openvoice_profile.json'));
}

if (fs.existsSync('/data/system/device.json')) {
  deviceConfig = JSON.parse(fs.readFileSync('/data/system/device.json'));
}

if (fs.existsSync('/data/plugins/KeyHandler.json')) {
  keyEventPlugin = require('/data/plugins/KeyHandler.json');
} else if (fs.existsSync('/data/plugins/KeyHandler.js')) {
  keyEventPlugin = require('/data/plugins/KeyHandler.js');
}

if (fs.existsSync('/data/plugins/EventHandler.js')) {
  voiceEventPlugin = require('/data/plugins/EventHandler.js');
}

function emitEvent(name, argv) {
  if (voiceEventPlugin && voiceEventPlugin instanceof EventEmitter) {
    voiceEventPlugin.emit(name, argv);
  }
}

module.exports = {
  /**
   * @property config
   */
  get config() {
    if (!config)
      throw new Error('config is exists');
    return config;
  },
  /**
   * @property deviceConfig
   */
  get deviceConfig() {
    return Object.assign({
      namePrefix: 'Rokid-Devboard-',
    }, deviceConfig);
  },
  /**
   * @property keyEventHandler
   */
  get keyEventHandler() {
    return keyEventPlugin;
  },
  /**
   * @method emitVoiceEvent
   */
  emitVoiceEvent: emitEvent,
  /**
   * @method emitEvent
   */
  emitEvent: emitEvent,
};
