'use strict'
var EventEmitter = require('events')
var logger = require('logger')('@ipc')

/**
 * interface Descriptor {
 *   type: 'method' | 'namespace' | 'event'
 * }
 *
 * interface Profile {
 *   [key: string]: Descriptor
 * }
 *
 * interface NamespaceDescriptor {
 *   type: 'namespace'
 *   [key: string]: Descriptor
 * }
 *
 * interface MethodDescriptor {
 *   type: 'method'
 *   returns: 'promise'
 * }
 *
 * interface EventDescriptor {
 *   type: 'event'
 * }
 *
 * interface ValueDescriptor {
 *   type: 'value'
 *   value: any
 * }
 */

var eventBus = new EventEmitter()

var invocationId = 0
var MethodProxies = {
  promise: (name, descriptor, ns) => function proxy () {
    var id = invocationId
    invocationId += 1

    var args = Array.prototype.slice.call(arguments, 0)
    return new Promise((resolve, reject) => {
      eventBus.once(`promise:${id}`, function onCallback (msg) {
        if (msg.action === 'resolve') {
          return resolve(msg.result)
        }
        if (msg.action === 'reject') {
          return reject(new Error(msg.error))
        }
        var err = new Error('Unknown response message type from VuiDaemon.')
        err.msg = msg
        reject(err)
      })

      process.send({
        type: 'invoke',
        invocationId: id,
        namespace: ns.name,
        method: name,
        params: args
      })
    })
  }
}

var PropertyDescriptions = {
  namespace: function Namespace (name, descriptor/** , namespace, nsProfile */) {
    var ns = new EventEmitter()
    ns.name = name
    Object.keys(descriptor).forEach(step)

    function step (key) {
      var propDescriptor = descriptor[key]
      if (typeof propDescriptor !== 'object') {
        return
      }
      if (descriptorTypes.indexOf(propDescriptor.type) < 0) {
        return
      }
      var ret = PropertyDescriptions[propDescriptor.type](key, propDescriptor, ns, descriptor)
      if (propDescriptor.type !== 'event') {
        ns[key] = ret
      }
    }
    return ns
  },
  method: function Method (name, descriptor, namespace, nsDescriptor) {
    var proxyfier = MethodProxies[descriptor.returns]
    if (typeof proxyfier !== 'function') {
      throw new Error(`Not implemented return type '${descriptor.returns}' for function '${name}'.`)
    }

    return proxyfier(name, descriptor, namespace, nsDescriptor)
  },
  event: function Event (name, descriptor, namespace, nsDescriptor) {
    eventBus.on(`event:${name}`, function onEvent (params) {
      EventEmitter.prototype.emit.apply(namespace, [ name ].concat(params))
    })

    process.send({
      type: 'subscribe',
      namespace: namespace.name,
      event: name
    })
  },
  'event-ack': function EventAck (name, descriptor, namespace, nsDescriptor) {
    eventBus.on(`event-syn:${name}`, function onEvent (eventId, params) {
      try {
        EventEmitter.prototype.emit.apply(namespace, [ name ].concat(params))
      } catch (err) {
        return process.send({
          type: 'event-ack',
          namespace: namespace.name,
          event: name,
          eventId: eventId,
          error: err.message
        })
      }
      process.send({
        type: 'event-ack',
        namespace: namespace.name,
        event: name,
        eventId: eventId
      })
    })

    process.send({
      type: 'subscribe-ack',
      namespace: namespace.name,
      event: name
    })
  },
  value: function Value (name, descriptor, namespace, nsDescriptor) {
    return descriptor.value
  }
}
var descriptorTypes = Object.keys(PropertyDescriptions)

module.exports.translate = translate
function translate (descriptor) {
  if (typeof process.send !== 'function') {
    throw new Error('IpcTranslator must work in child process.')
  }

  var activity = PropertyDescriptions.namespace(null, descriptor, null, null)

  listenIpc()
  return activity
}

var listenMap = {
  event: msg => {
    var channel = `event:${msg.event}`
    if (!Array.isArray(msg.params)) {
      logger.error(`Params of event message '${channel}' is not an array.`)
      return
    }
    return eventBus.emit(channel, msg.params)
  },
  'event-syn': msg => {
    var channel = `event-syn:${msg.event}`
    if (!Array.isArray(msg.params)) {
      logger.error(`Params of event message '${channel}' is not an array.`)
      return
    }
    return eventBus.emit(channel, msg.eventId, msg.params)
  },
  promise: msg => {
    var channel = `promise:${msg.invocationId}`
    return eventBus.emit(channel, msg)
  },
  'fatal-error': msg => {
    var err = new Error(msg.message)
    throw err
  }
}

function listenIpc () {
  process.on('message', function onMessage (message) {
    logger.debug('Received VuiDaemon message', message)

    var handle = listenMap[message.type]
    if (handle == null) {
      logger.info(`Unhandled Ipc message type '${message.type}'.`)
      return
    }

    handle(message)
  })
}
