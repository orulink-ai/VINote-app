const { test } = require('node:test')
const assert = require('node:assert/strict')
const { planAndroidCommand } = require('./android-build.cjs')

test('four Android entry points keep channel, package and runtime together', () => {
  const cases = [
    ['test:debug', 'test', 'com.vinoteapp.test', true, undefined],
    ['test:apk', 'test', 'com.vinoteapp.test', false, 'vinote-test.apk'],
    ['vinote:debug', 'public', 'com.vinoteapp.dev', true, undefined],
    ['vinote:apk', 'public', 'com.vinoteapp', false, 'vinote.apk'],
  ]
  for (const [mode, channel, appId, needsMetro, artifact] of cases) {
    const plan = planAndroidCommand(mode)
    assert.equal(plan.channel, channel)
    assert.equal(plan.appId, appId)
    assert.equal(plan.needsMetro, needsMetro)
    assert.equal(plan.artifact, artifact)
    assert.ok(plan.args.includes(`-PvinoteChannel=${channel}`))
  }
  assert.throws(() => planAndroidCommand('unknown'))
})
