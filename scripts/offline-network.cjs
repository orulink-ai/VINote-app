// Test-process guard only. Never loaded by the App or its build/bundle pipeline.
const forbidden = () => { throw new Error('Offline tests forbid real network I/O; mock the service') }
require('node:net').Socket.prototype.connect = forbidden
require('node:tls').connect = forbidden
const dns = require('node:dns')
dns.lookup = forbidden
dns.resolve = forbidden
dns.promises.lookup = forbidden
dns.promises.resolve = forbidden
globalThis.fetch = async () => forbidden()
