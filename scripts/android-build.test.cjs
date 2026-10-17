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


test('every embedded bundle requires content and integration before building', () => {
  for (const mode of ['test:apk', 'standalone', 'vinote:apk', 'release', 'bundle']) {
    const plan = planAndroidCommand(mode)
    assert.equal(plan.requireGeneration, true, mode)
    assert.equal(plan.requireIntegration, true, mode)
  }
  for (const mode of ['test:debug', 'vinote:debug']) {
    assert.equal(planAndroidCommand(mode).requireGeneration, false)
    assert.equal(planAndroidCommand(mode).requireIntegration, false)
  }
})


test('standalone build rejects either missing service before any native command', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
  const { createRequire } = require('node:module')
  const filename = path.join(__dirname, 'android-build.cjs')
  const realRequire = createRequire(filename)
  const source = fs.readFileSync(filename, 'utf8')
  for (const mode of ['test:apk', 'standalone', 'vinote:apk', 'release', 'bundle']) {
    for (const missing of ['generationBaseUrl', 'integrationBaseUrl', null]) {
      const config = { ...require('../config/deployment.test.json') }
      if (missing) config[missing] = ''
      let spawns = 0
      const module = { exports: {} }
      const fakeRequire = name => {
        if (name === './select-deployment.cjs') return { selectDeployment: () => config }
        if (name === 'node:child_process') return { spawnSync: () => { spawns++; return { status: 1 } } }
        return realRequire(name)
      }
      fakeRequire.main = module
      const context = { require: fakeRequire, module, __dirname, process: { argv: ['node', filename, mode], platform: 'win32', execPath: process.execPath }, console }
      if (missing) assert.throws(() => vm.runInNewContext(source, context, { filename }), new RegExp(missing))
      else vm.runInNewContext(source, context, { filename })
      assert.equal(spawns, missing ? 0 : 1, `${mode}/${missing}`)
    }
  }
})

test('direct Gradle standalone and release guard both require integration and content', () => {
  const fs = require('node:fs'), path = require('node:path')
  const gradle = fs.readFileSync(path.join(__dirname, '../android/app/build.gradle'), 'utf8')
  const standalone = gradle.slice(gradle.indexOf("if (project.hasProperty('vinoteStandalone'))"), gradle.indexOf('def requestedChannel'))
  assert.match(standalone, /'--require-generation', '--require-integration'/)
  const release = gradle.slice(gradle.indexOf('def checkReleaseContentService'), gradle.indexOf('// Standalone'))
  assert.match(release, /'--require-generation', '--require-integration', '--require-public'/)
})
