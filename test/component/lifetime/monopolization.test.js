var test = require('tape')
var _ = require('@yoda/util')._

var bootstrap = require('./bootstrap')

test('monopolization', t => {
  var tt = bootstrap()
  var life = tt.component.lifetime

  Promise.all(_.times(3).map(idx => life.createApp(`${idx}`)))
    .then(() => {
      life.monopolist = '1'

      t.strictEqual(life.isMonopolized(), false, 'monologue shall not be started by app not on top of stack')

      return life.activateAppById('1')
    })
    .then(() => {
      life.monopolist = '1'
      t.strictEqual(life.getCurrentAppId(), '1')
      t.strictEqual(life.isMonopolized(), true, 'monologue shall be started by app top of stack')

      return life.activateAppById('2')
        .then(() => {
          t.fail('app 2 shall not interrupt monologue of app 1')
        })
        .catch(err => {
          t.strictEqual(err.message, 'App 1 monopolized top of stack.')
        })
    })
    .then(() => {
      return life.suspendAppById('1')
    })
    .then(() => {
      t.strictEqual(life.isMonopolized(), false, 'monologue shall not be continue by app not on top of stack')

      return life.activateAppById('2')
    })
    .then(() => {
      t.strictEqual(life.getCurrentAppId(), '2')
      t.end()
    })
    .catch(err => {
      t.error(err)
      t.end()
    })
})

test('monopolist could be activated repetitively', t => {
  var tt = bootstrap()
  var life = tt.component.lifetime

  Promise.all(_.times(3).map(idx => life.createApp(`${idx}`)))
    .then(() => {
      life.monopolist = '1'

      t.strictEqual(life.isMonopolized(), false, 'monologue shall not be started by app not on top of stack')

      return life.activateAppById('1')
    })
    .then(() => {
      life.monopolist = '1'
      t.strictEqual(life.getCurrentAppId(), '1')
      t.strictEqual(life.isMonopolized(), true, 'monologue shall be started by app top of stack')

      return life.activateAppById('1')
    })
    .then(() => {
      t.strictEqual(life.getCurrentAppId(), '1')
      t.strictEqual(life.isMonopolized(), true, 'monologue shall be started by app top of stack')

      return life.suspendAppById('1')
    })
    .then(() => {
      t.strictEqual(life.isMonopolized(), false, 'monologue shall not be continue by app not on top of stack')

      t.end()
    })
    .catch(err => {
      t.error(err)
      t.end()
    })
})
