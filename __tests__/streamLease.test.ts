import deployment from '../config/deployment.json'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, captureStreamScope, assertStreamScope,
  assertStreamResultScope, captureRemoteScope, assertRemoteScope, pauseRemote } from '../src/lib/sessionGate'

jest.mock('../src/config/env', () => ({ API_BASE_URL: 'https://asr.invalid', AUTH_BASE_URL: 'https://auth.invalid' }))
jest.mock('../config/deployment.json', () => ({ integrationBaseUrl: 'https://integration.invalid' }))
const verify = () => finishVerification(beginVerification('A'), 'verified')
beforeEach(() => { transitionIdentity('A'); verify() })

test('running permit survives background checking, foreground reverify and normal renewal; strict requests do not', () => {
  const stream = captureStreamScope('A'), request = captureRemoteScope('A')
  pauseRemote()
  expect(() => assertStreamScope(stream)).not.toThrow()
  expect(() => captureStreamScope('A')).toThrow()
  expect(() => assertStreamResultScope(stream)).toThrow()
  const ticket = beginVerification('A')
  expect(() => assertStreamScope(stream)).not.toThrow()
  finishVerification(ticket, 'verified')
  expect(() => assertStreamResultScope(stream)).not.toThrow()
  expect(() => assertRemoteScope(request)).toThrow()
  verify()
  expect(() => assertStreamResultScope(stream)).not.toThrow()
})

test.each(['expired', 'signed-out', 'offline-known'] as const)('%s permanently revokes the old permit even after the same owner verifies', mode => {
  const stream = captureStreamScope('A')
  pauseRemote(mode)
  expect(() => assertStreamScope(stream)).toThrow()
  verify()
  expect(() => assertStreamScope(stream)).toThrow()
})

test.each(['checking', 'offline-known', 'expired'] as const)('unsuccessful verification %s cannot extend a running permit', mode => {
  const stream = captureStreamScope('A')
  finishVerification(beginVerification('A'), mode)
  expect(() => assertStreamScope(stream)).toThrow()
  verify()
  expect(() => assertStreamScope(stream)).toThrow()
})

test('unknown verification failure and forged permit fail closed', () => {
  const stream = captureStreamScope('A')
  expect(() => assertStreamScope({ ...stream })).toThrow()
  pauseRemote('checking', true)
  expect(() => assertStreamScope(stream)).toThrow()
})

test('logout and A-B-A cannot restore an old stream', () => {
  const stream = captureStreamScope('A')
  transitionIdentity(null)
  expect(() => assertStreamScope(stream)).toThrow()
  transitionIdentity('B'); transitionIdentity('A'); verify()
  expect(() => assertStreamScope(stream)).toThrow()
})

test.each(['asr', 'auth', 'integration'])('%s origin changes invalidate the permit', origin => {
  const stream = captureStreamScope('A')
  const config = jest.requireMock('../src/config/env') as { API_BASE_URL: string; AUTH_BASE_URL: string }
  const oldAsr = config.API_BASE_URL, oldAuth = config.AUTH_BASE_URL, oldIntegration = deployment.integrationBaseUrl
  try {
    if (origin === 'asr') config.API_BASE_URL = 'https://other.invalid'
    if (origin === 'auth') config.AUTH_BASE_URL = 'https://other.invalid'
    if (origin === 'integration') deployment.integrationBaseUrl = 'https://other.invalid'
    expect(() => assertStreamScope(stream)).toThrow()
    expect(() => assertStreamResultScope(stream)).toThrow()
  } finally { config.API_BASE_URL = oldAsr; config.AUTH_BASE_URL = oldAuth; deployment.integrationBaseUrl = oldIntegration }
})
