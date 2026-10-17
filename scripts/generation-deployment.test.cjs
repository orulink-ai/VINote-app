const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateDeployment } = require('./validate-deployment.cjs')
const base = { channel: 'public', apiBaseUrl: 'https://models.vinote.app', authBaseUrl: 'https://account.vinote.app', integrationBaseUrl: 'https://account.vinote.app/vinote-api', generationBaseUrl: '', accountProxyHost: '', accountProxyPort: 7890 }

test('content service is explicit and release packaging requires it', () => {
  assert.doesNotThrow(() => validateDeployment(base))
  assert.throws(() => validateDeployment(base, { requireGeneration: true }), /generationBaseUrl/)
  const configured = { ...base, generationBaseUrl: 'https://content.vinote.app/vinote-content/' }
  assert.doesNotThrow(() => validateDeployment(configured, { requireGeneration: true }))
  assert.doesNotThrow(() => validateDeployment({ ...base, generationBaseUrl: base.integrationBaseUrl }, { requireGeneration: true }))
})

test('content service cannot borrow model or account roots or embed credentials', () => {
  for (const generationBaseUrl of [base.apiBaseUrl, base.apiBaseUrl + '/', base.authBaseUrl, 'http://content.vinote.app', 'https://127.1', 'https://server.local', 'https://content.invalid', 'https://u:p@content.vinote.app', 'https://content.vinote.app?key=x', 'https://content.vinote.app/#x', 'https://content.vinote.app/a/../b', 'https://content.vinote.app/%2e%2e', 'https://content.vinote.app//b']) {
    assert.throws(() => validateDeployment({ ...base, generationBaseUrl }), generationBaseUrl)
  }
  assert.throws(() => validateDeployment({ ...base, generationBaseUrl: 42 }))
})


test('LAN standalone uses explicit public content and integration with LAN models', () => {
  const config = require('../config/deployment.test.json')
  assert.equal(config.apiBaseUrl, 'http://192.168.1.143:9876')
  assert.equal(config.integrationBaseUrl, 'https://supabase-vinote.orulink.ai/vinote-api')
  assert.equal(config.generationBaseUrl, config.integrationBaseUrl)
  assert.doesNotThrow(() => validateDeployment(config, { requireGeneration: true, requireIntegration: true }))
  const { resolveGenerationBaseUrl } = require('../src/config/generationService')
  assert.equal(resolveGenerationBaseUrl(config, false), config.generationBaseUrl)
  assert.equal(resolveGenerationBaseUrl(config, true), 'http://127.0.0.1:8900')
})

test('standalone rejects missing integration even with valid content', () => {
  const config = { ...base, generationBaseUrl: 'https://content.vinote.app' }
  for (const integrationBaseUrl of ['', undefined, '   ', 42]) {
    assert.throws(() => validateDeployment({ ...config, integrationBaseUrl }, { requireGeneration: true, requireIntegration: true }), /integrationBaseUrl/)
  }
  assert.doesNotThrow(() => validateDeployment({ ...config, integrationBaseUrl: '' }))
})
