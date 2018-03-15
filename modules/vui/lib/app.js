'use strict';

const fs = require('fs');
const net = require('net');
const fresh = require('import-fresh');
const dbus = require('dbus').getBus('session');
const EventEmitter = require('events').EventEmitter;

/**
 * @class NativeConnector
 * @extends EventEmitter
 */
class NativeConnector extends EventEmitter {
  /**
   * @method constructor
   * @param {String} appid
   * @param {Object} runtime
   * @param {String} exec
   */
  constructor(appid, runtime, exec) {
    super();
    this._pid = -1;
    this._appid = appid;
    this._runtime = runtime;
    this._exec = exec;
    this._pending = false;
    this._remoteMethods = null;
    this.on('create', this._onEvent.bind(this, 'create'));
    this.on('restart', this._onEvent.bind(this, 'restart'));
    this.on('pause', this._onEvent.bind(this, 'pause'));
    this.on('resume', this._onEvent.bind(this, 'resume'));
    this.on('stop', this._onEvent.bind(this, 'stop'));
    this.on('destroy', this._onEvent.bind(this, 'destroy'));
    this.on('voice_command', this._onEvent.bind(this, 'voiceCommand'));
    this.on('key_event', this._onEvent.bind(this, 'keyEvent'));
  }
  /**
   * @method _getRemoteInterface
   */
  _getRemoteInterface() {
    return new Promise((resolve, _) => {
      if (this._remoteMethods !== null)
        return resolve({error: null, iface: this._remoteMethods});
      const serviceName = 'com.rokid.X' + this._appid;
      const objectPath = '/rokid/openvoice';
      const interfaceName = 'rokid.openvoice.NativeBase';
      dbus.getInterface(serviceName, objectPath, interfaceName, (error, iface) => {
        if (iface && iface !== null)
          this._remoteMethods = iface;
        resolve({ error, iface });
      });
    });
  }
  /**
   * @method _forkAndWait
   * @param {String} exec
   * @param {Number} timeout
   */
  _forkAndWait(exec, timeout=500) {
    if (!this._pending) {
      this._pending = new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
          this._pending = false;
          reject(new Error('start apps timeout'));
        }, 2000);
        let socket = net.connect(10004/*zygote port*/, () => {
          const cmd = `${exec} com.rokid.X${this._appid} &`;
          socket.write(cmd, () => {
            clearTimeout(timer);
            socket.end();
            setTimeout(() => {
              this._pending = false;
              resolve();
            }, timeout);
          });
        });
      });
    }
    return this._pending;
  }
  /**
   * @method _notify
   * @param {String} event
   * @param {Array} args
   */
  _notify(event, args) {
    let oldArgs = Object.assign([], args);
    return this._getRemoteInterface().then((response) => {
      if (response.error) {
        return this._forkAndWait(this._exec).then(() => {
          // re-fetch the remote interfaces again
          return this._getRemoteInterface();
        });
      }
      return response;
    }).then((response) => {
      if (response.error)
        throw new Error(`notify ${event} with ${this._appid} failed: ${response.error}`);

      // call GetInfo to get the pid of process
      return new Promise((resolve, reject) => {
        response.iface.GetInfo((err, data) => {
          if (err) {
            // clear dbus interfaces
            dbus.interfaces = {};
            this._remoteMethods = null;
            // FIXME(yorkie): resolve doesn't get called, need finish this?
            this._notify(event, oldArgs);
          } else {
            try {
              const info = JSON.parse(data);
              const pid = info.PID || info.pid;
              if (!pid || typeof pid !== 'number')
                throw new TypeError(`invalid pid for <${event}>`);
              this._pid = info.pid;
              resolve(response.iface);
            } catch (err) {
              reject(err);
            }
          }
        });
      });
    }).then((methods) => {
      let name = 'on' + event[0].toUpperCase() + event.slice(1);
      if (typeof methods[name] !== 'function')
        throw new Error(`The nativeapp ${this._appid} do not have ${name}()`);
      
      return new Promise((resolve, reject) => {
        args.push((err, data) => {
          if (err) {
            console.error(`occurs an error on <${event}>: ${err}`);
          } else {
            resolve(data);
          }
        });
        methods[name].apply(methods, args);
      });
    }).catch((err) => {
      console.error(err && err.stack);
    });
  }
  /**
   * @method _onEvent
   */
  _onEvent(name, ...args) {
    return this._notify(name, args);
  }
}

/**
 * @class ExtappConnector
 */
class ExtappConnector extends EventEmitter {
  constructor(appid, runtime, executor) {
    super();
    this._appid = appid;
    this._runtime = runtime;
    this._executor = executor;
    this.on('create', this._onEvent.bind(this, 'create'));
    this.on('restart', this._onEvent.bind(this, 'restart'));
    this.on('pause', this._onEvent.bind(this, 'pause'));
    this.on('resume', this._onEvent.bind(this, 'resume'));
    this.on('stop', this._onEvent.bind(this, 'stop'));
    this.on('destroy', this._onEvent.bind(this, 'destroy'));
    this.on('voice_command', this._onEvent.bind(this, 'voiceCommand'));
    this.on('key_event', this._onEvent.bind(this, 'keyEvent'));
  }
  /**
   * @method _onEvent
   */
  _onEvent(name, ...args) {
    const { metadata } = this._executor._profile;
    let eventName = null;
    let params = args;
    switch (name) {
      case 'create': 
        eventName = 'onCreate';
        break;
      case 'restart':
        eventName = 'onRestart';
        break;
      case 'pause':
        eventName = 'onPause';
        break;
      case 'resume':
        eventName = 'onResume';
        break;
      case 'stop':
        eventName = 'onStop';
        break;
      case 'destroy':
        eventName = 'onDestroy';
        break;
      case 'voiceCommand':
        eventName = 'nlp';
        params = [
          args[0].asr,
          JSON.stringify(args[0]),
        ];
        break;
      default:
        eventName = null;
        break;
    }

    if (!eventName) {
      return;
    }
    dbus._dbus.emitSignal(
      dbus.connection,
      metadata.dbus.objectPath,
      metadata.dbus.ifaceName,
      eventName,
      params,
      params.map(i => 's')
    );
  }
}

/**
 * @class AppExecutor
 */
class AppExecutor {
  /**
   * @method constructor
   */
  constructor(profile, prefix) {
    this._type = 'light';
    this._exec = null;
    this._errmsg = null;
    this._valid = false;
    this._profile = profile;

    if (profile.metadata.native) {
      this._type = 'native';
      this._exec = `${prefix}/${profile.main || 'runtime'}`;
      this._connector = null;
    } else if (profile.metadata.extapp) {
      this._type = 'extapp';
      this._exec = __dirname + '/client/extapp.js';
      this._connector = null;
    } else {
      this._exec = `${prefix}/app.js`;
    }
    if (!fs.existsSync(this._exec)) {
      this._valid = false;
      this._errmsg = `${this._exec} not found`;
    } else {
      this._valid = true;
    }
  }
  /**
   * @getter errmsg
   */
  get errmsg() {
    return this._errmsg;
  }
  /**
   * @getter valid
   */
  get valid() {
    return this._valid;
  }
  /**
   * @method createHandler
   * @param {String} appid
   * @param {Object} runtime
   */
  createHandler(appid, runtime) {
    if (!this._connector) {
      if (this._type === 'light') {
        // FIXME(Yazhong): fresh would lost state
        this._connector = require(this._exec)(appid, runtime);
      } else if (this._type === 'native') {
        this._connector = new NativeConnector(appid, runtime, this._exec, this);
      } else if (this._type === 'extapp') {
        this._connector = new ExtappConnector(appid, runtime, this);
      }
    }
    return this._connector;
  }
}

var appMgr;

/**
 * @class AppManager
 */
class AppManager {
  /**
   * @method constructor
   * @param {Array} paths - the watch paths for light apps
   * @param {Object} the runtime object
   */
  constructor(paths, runtime) {
    this._paths = paths;
    this._runtime = runtime;
    this._skill2app = {};
    this._list = this.load();
    appMgr = this;
  }
  /**
   * @method toString
   */
  toString() {
    return this._list.map((item) => {
      return `load app at ${item.pathname} for ${item.metadata.skills}`;
    }).join('\n');
  }
  /**
   * @method load
   */
  load() {
    return this._paths.reduce((apps, pathname) => {
      if (fs.existsSync(pathname)) {
        apps = apps.concat(
          fs.readdirSync(pathname).map(this.getApp.bind(this, pathname)));
      }
      return apps;
    }, []);
  }
  /**
   * @method reload
   */
  reload() {
    this._skill2app = {};
    this._list = this.load();
  }
  /**
   * @method getApp
   * @param {String} root - the root pathname
   * @param {String} name - the app name
   */
  getApp(root, name) {
    const prefix = `${root}/${name}`;
    const pkgInfo = fresh(`${prefix}/package.json`);
    for (let i in pkgInfo.metadata.skills) {
      // FIXME(Yazhong): should we not throw error just skip this error?
      const id = pkgInfo.metadata.skills[i];
      if (this._skill2app[id])
        throw new Error('skill conflicts');
      let app = new AppExecutor(pkgInfo, prefix);
      if (app.valid) {
        app.skills = pkgInfo.metadata.skills;
        this._skill2app[id] = app;
      } else {
        throw new Error(app.errmsg);
      }
    }
    return {
      pathname: prefix,
      metadata: pkgInfo.metadata,
    };
  }
  /**
   * @method getHandlerById
   * @param {String} appid - the skill id to find the handler
   */
  getHandlerById(appid) {
    if (appid[0] === '@') {
      const skills = this._skill2app[appid].skills;
      for (let i = 0; i < skills.length; i++) {
        let s = skills[i];
        if (s && s[0] !== '@' && s.length === 32) {
          appid = s;
          break;
        }
      }
    }
    let app = this._skill2app[appid];
    if (!app) {
      // check extapp firstly
      const extapp = this._skill2app['@extapp'];
      if (extapp) {
        const handler = extapp.createHandler(appid, this._runtime);
        handler.emit('beforeCreate', appid);
        if (handler._state === 'beforeCreate OK') {
          return handler;
        }
      }
      // use miss
      app = this._skill2app.miss || this._skill2app['@miss'];
    }
    return app.createHandler(appid, this._runtime);
  }
  /**
   * @method register
   */
  register(appId, config) {
    this._skill2app[appId] = new AppExecutor({
      metadata: config,
    });
  }
  /**
   * @method destroy
   */
  destroy(appId) {
    delete this._skill2app[appId];
  }
}

exports.AppManager = AppManager;
exports.getAppMgr = function() {
  return appMgr;
};
