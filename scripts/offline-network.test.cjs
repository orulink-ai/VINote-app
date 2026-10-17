const { test } = require('node:test')
const assert = require('node:assert/strict')
test('offline guard blocks actual fetch, DNS and sockets before network dispatch', async () => {
  // Each node:test file runs in its own process.
  require('./offline-network.cjs')
  await assert.rejects(() => fetch('https://synthetic.invalid'), /Offline tests/)
  assert.throws(() => require('node:dns').lookup('synthetic.invalid'), /Offline tests/)
  assert.throws(() => new (require('node:net').Socket)().connect(443, 'synthetic.invalid'), /Offline tests/)
})
