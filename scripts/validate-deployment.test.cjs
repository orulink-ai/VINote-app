const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateDeployment } = require('./validate-deployment.cjs')
const base = { channel: 'public', apiBaseUrl: 'https://api.vinote.app', authBaseUrl: 'https://account.supabase.co', accountProxyHost: '', accountProxyPort: 7890 }
test('reject private addresses, IP aliases and local names in public builds', () => {
  for (const host of ['192.168.1.143', '10.0.2.2', '172.16.0.1', '127.1', '2130706433', '[::1]', '[fc00::1]', 'server', 'server.local', 'LOCALHOST.', 'server.home.arpa']) {
    assert.throws(() => validateDeployment({ ...base, apiBaseUrl: `https://${host}` }), host)
  }
})
test('validate origins, authentication TLS, proxies and channels', () => {
  assert.doesNotThrow(() => validateDeployment(base))
  assert.doesNotThrow(() => validateDeployment({ ...base, channel: 'lan', apiBaseUrl: 'http://192.168.1.143:9876' }))
  for (const patch of [{ apiBaseUrl: 'http://api.vinote.app' }, { authBaseUrl: 'http://account.supabase.co' }, { apiBaseUrl: 'https://user:pass@api.vinote.app' }, { apiBaseUrl: 'https://api.vinote.app/v1' }, { accountProxyHost: '192.168.1.101' }, { accountProxyPort: 0 }, { channel: 'unknown' }]) assert.throws(() => validateDeployment({ ...base, ...patch }))
})
