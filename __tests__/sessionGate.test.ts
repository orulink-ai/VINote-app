import * as Keychain from 'react-native-keychain'
import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readSession, saveSession, clearToken, type Session } from '../src/lib/storage'
import { identityEpoch } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, captureRemoteScope, assertRemoteScope, pauseRemote, remoteReady, identityScope } from '../src/lib/sessionGate'
import { integrationJson } from '../src/lib/integration'
import { apiJson, apiTextStream } from '../src/lib/api'
import { requestTextStream } from '../src/lib/textStream'
import { verifySession } from '../src/lib/sessionVerifier'
import { rememberVerifiedCache, trustedLocalCache } from '../src/lib/ownerCacheScope'
import { syncWorkspace, requestWorkspaceSync } from '../src/lib/workspace'
import { editNoteContent, getNote } from '../src/lib/notes'
import { writeWorkspace } from '../src/lib/workspaceStorage'
import { queueAutomaticDelivery, flushAutomaticDeliveries } from '../src/lib/feishu'
import { accessToken } from '../src/lib/supabase'
import { ApiError } from '../src/lib/errors'
import { remoteRequest } from '../src/lib/remoteRequest'

jest.mock('../src/lib/textStream', () => ({ requestTextStream: jest.fn() }))
const session = (id = 'A'): Session => ({ user: { id, email: 'synthetic@example.invalid' }, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' })
const response = (status: number, data: unknown): Response => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data), headers: new Headers() }) as Response
const network = jest.fn()
let stored: Session | null
const grant = () => { const ticket = beginVerification('A'); finishVerification(ticket, 'verified'); return ticket }
beforeEach(async () => {
  jest.clearAllMocks()
  stored = null
  jest.mocked(Keychain.setGenericPassword).mockImplementation(async (_name, value) => { stored = JSON.parse(value); return false })
  jest.mocked(Keychain.getGenericPassword).mockImplementation(async () => stored ? ({ username: stored.user.id, password: JSON.stringify(stored) } as any) : false)
  jest.mocked(Keychain.resetGenericPassword).mockImplementation(async () => { stored = null; return true })
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.mocked(FS.exists).mockResolvedValue(false)
  globalThis.fetch = network
  network.mockReset()
  await saveSession(session())
})
afterEach(() => pauseRemote())

test('closed gate blocks business GET, POST and stream before network or refresh', async () => {
  await expect(integrationJson('/api/mcp-connections/runs', { method: 'POST' }, 'A')).rejects.toMatchObject({ code: 'SESSION_NOT_VERIFIED' })
  await expect(integrationJson('/api/workspace/notes', {}, 'A')).rejects.toMatchObject({ code: 'WORKSPACE_REMOVED' })
  await expect(apiJson('/v1/models', {}, 'A')).rejects.toMatchObject({ code: 'SESSION_NOT_VERIFIED' })
  await expect(apiTextStream('/chat', {}, jest.fn(), 'A')).rejects.toMatchObject({ code: 'SESSION_NOT_VERIFIED' })
  expect(network).not.toHaveBeenCalled(); expect(requestTextStream).not.toHaveBeenCalled()
})

test('credential rotation preserves identity grant, while A→B→A invalidates it', async () => {
  grant(); const scope = captureRemoteScope('A'), epoch = identityEpoch()
  await saveSession({ ...session(), access_token: 'rotated' }, { refresh: true, guard: () => assertRemoteScope(scope) })
  expect(identityEpoch()).toBe(epoch); expect(remoteReady('A')).toBe(true)
  await clearToken(); await saveSession(session('B')); await saveSession(session())
  grant(); expect(() => assertRemoteScope(scope)).toThrow()
})

test('concurrent same-owner refresh contexts rotate once without fabricating an account switch', async () => {
  grant()
  const first = remoteRequest('A'), second = remoteRequest('A')
  let release!: (value: Response) => void
  network.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const results = Promise.allSettled([
    accessToken(true, 'A', first.context), accessToken(true, 'A', second.context),
  ])
  try {
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(network).toHaveBeenCalledTimes(1)
    release(response(200, { ...session(), access_token: 'rotated-once' }))
    expect(await results).toEqual([
      { status: 'fulfilled', value: 'rotated-once' }, { status: 'fulfilled', value: 'rotated-once' },
    ])
    first.guard(); second.guard()
  } finally { first.close(); second.close() }
})

test.each(['cancel', 'A-B-A'] as const)('queued refresh retains its own %s guard and cannot accept a new token', async outcome => {
  grant()
  const first = remoteRequest('A'), second = remoteRequest('A'), controller = new AbortController()
  const context = { ...second.context, guard: () => { second.guard(); if (controller.signal.aborted) throw new Error('caller cancelled') } }
  let release!: (value: Response) => void
  network.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const results = Promise.allSettled([accessToken(true, 'A', first.context), accessToken(true, 'A', context)])
  try {
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(network).toHaveBeenCalledTimes(1)
    if (outcome === 'cancel') controller.abort()
    else { await saveSession(session('B')); await saveSession(session()); grant() }
    release(response(200, { ...session(), access_token: 'new-token' }))
    const observed = await results
    expect(observed[1].status).toBe('rejected')
    expect(observed[0].status).toBe(outcome === 'cancel' ? 'fulfilled' : 'rejected')
    expect(network).toHaveBeenCalledTimes(1)
    expect((await readSession())?.access_token).toBe(outcome === 'cancel' ? 'new-token' : 'synthetic-access')
  } finally { first.close(); second.close() }
})

test('a new verification invalidates old requests even for the same owner', async () => {
  grant(); const scope = captureRemoteScope('A')
  grant(); expect(() => assertRemoteScope(scope)).toThrow()
})

test('late response after background pause is discarded, with no replay', async () => {
  grant(); let finish!: (value: Response) => void
  network.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = integrationJson('/api/feishu/deliveries', { method: 'POST', body: '{}' }, 'A')
  while (!finish) await Promise.resolve()
  pauseRemote(); grant(); finish(response(200, { id: 'old-result' }))
  await expect(pending).rejects.toThrow()
  expect(network).toHaveBeenCalledTimes(1)
  expect(network.mock.calls[0][1].signal.aborted).toBe(true)
})

test('late decoded JSON cannot become a result after an account switch', async () => {
  grant(); let finish!: (value: string) => void
  network.mockResolvedValueOnce({ ...response(200, {}), text: () => new Promise(resolve => { finish = resolve }) })
  const pending = apiJson('/v1/models', {}, 'A')
  while (!finish) await Promise.resolve()
  await saveSession(session('B')); finish('{"data":["A-only"]}')
  await expect(pending).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1)
})

test('stream callbacks and final success cannot cross an old verification lease', async () => {
  grant(); const receive = jest.fn()
  let finish!: (value: any) => void, callback!: (text: string) => void
  jest.mocked(requestTextStream).mockImplementationOnce((_url, _init, next) => {
    callback = next; return new Promise(resolve => { finish = resolve })
  })
  const pending = apiTextStream('/chat', {}, receive, 'A')
  while (!finish) await Promise.resolve()
  pauseRemote(); grant()
  expect(() => callback('late A text')).toThrow(); expect(receive).not.toHaveBeenCalled()
  finish({ status: 200, text: '', contentType: 'text/event-stream' })
  await expect(pending).rejects.toThrow()
})

test('late old-owner 401 cannot refresh or expire the new owner', async () => {
  const ticket = beginVerification('A'), controller = new AbortController()
  let finish!: (value: Response) => void
  network.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = verifySession(ticket, controller.signal)
  while (!finish) await Promise.resolve()
  await saveSession(session('B')); finish(response(401, {}))
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_SCOPE_CHANGED' })
  expect((await readSession())?.user.id).toBe('B'); expect(network).toHaveBeenCalledTimes(1)
})

test('canceling an in-flight refresh rejects its late success before credential save', async () => {
  const scope = identityScope('A'); await rememberVerifiedCache(scope)
  const ticket = beginVerification('A'), controller = new AbortController()
  let finish!: (value: Response) => void
  network.mockResolvedValueOnce(response(401, {})).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const before = jest.mocked(Keychain.setGenericPassword).mock.calls.length
  const pending = verifySession(ticket, controller.signal)
  while (!finish) await Promise.resolve()
  controller.abort(); finish(response(200, { ...session(), access_token: 'must-not-save' }))
  await expect(pending).resolves.toBe('offline-known')
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(before)
  expect((await readSession())?.access_token).toBe('synthetic-access')
  expect(remoteReady()).toBe(false)
})

test.each([502, 503, 504])('provider HTTP %s preserves trusted cache and credentials', async status => {
  await rememberVerifiedCache(identityScope('A'))
  network.mockResolvedValueOnce(response(status, {}))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('offline-known')
  expect((await readSession())?.user.id).toBe('A'); expect(remoteReady()).toBe(false)
})

test.each([undefined, 'user_banned', 'unexpected_audience', 'unknown-private-code'])('HTTP403 %s cannot trigger refresh or open the gate', async code => {
  await rememberVerifiedCache(identityScope('A'))
  network.mockResolvedValueOnce(response(403, { error_code: code, msg: 'must-not-be-logged' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('offline-known')
  expect(network).toHaveBeenCalledTimes(1)
  expect(remoteReady()).toBe(false); expect((await readSession())?.user.id).toBe('A')
})

test('403 response code reaches only sanitized opt-in diagnostics, without raw error message', async () => {
  const flags = globalThis as typeof globalThis & { VINOTE_VERIFY_DIAGNOSTICS?: boolean }
  const output = jest.spyOn(console, 'info').mockImplementation(() => {})
  flags.VINOTE_VERIFY_DIAGNOSTICS = true
  try {
    await rememberVerifiedCache(identityScope('A'))
    network.mockResolvedValueOnce(response(403, { error_code: 'bad_jwt', msg: 'private-message-or-token' }))
      .mockResolvedValueOnce(response(400, { error_code: 'refresh_token_not_found' }))
    await verifySession(beginVerification('A'), new AbortController().signal)
    expect(output.mock.calls.some(([line]) => String(line).includes('stage=user_http') && String(line).includes('code=bad_jwt'))).toBe(true)
    expect(JSON.stringify(output.mock.calls)).not.toContain('private-message-or-token')
  } finally { delete flags.VINOTE_VERIFY_DIAGNOSTICS; output.mockRestore() }
})

test.each([401, 403])('definite refresh rejection after user HTTP%s is expired, without deleting local content', async status => {
  await rememberVerifiedCache(identityScope('A'))
  await Storage.setItem('vinote:A:note:draft', 'saved-draft')
  network.mockResolvedValueOnce(response(status, { code: 'bad_jwt' })).mockResolvedValueOnce(response(400, { error_code: 'refresh_token_not_found' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('expired')
  expect(network).toHaveBeenCalledTimes(2)
  expect(await Storage.getItem('vinote:A:note:draft')).toBe('saved-draft')
  expect(remoteReady()).toBe(false)
})

test('bad access JWT with refresh provider outage preserves trusted ownership without looping', async () => {
  await rememberVerifiedCache(identityScope('A'))
  network.mockResolvedValueOnce(response(403, { code: 'bad_jwt' }))
    .mockResolvedValueOnce(response(503, {}))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('offline-known')
  expect(network).toHaveBeenCalledTimes(2)
  expect((await readSession())?.user.id).toBe('A'); expect(remoteReady()).toBe(false)
})

test.each(['bad_jwt', 'session_expired', 'session_not_found'])('user 403 %s refreshes exactly once and requires fresh same-owner user 200', async code => {
  const epoch = identityEpoch()
  network.mockResolvedValueOnce(response(403, { error_code: code }))
    .mockResolvedValueOnce(response(200, { ...session(), access_token: 'synthetic-rotated' }))
    .mockResolvedValueOnce(response(200, { id: 'A' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('verified')
  expect(network).toHaveBeenCalledTimes(3)
  expect(network.mock.calls.map(([url]) => new URL(url).pathname + new URL(url).search)).toEqual([
    '/auth/v1/user', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/user',
  ])
  expect(identityEpoch()).toBe(epoch)
  expect(network.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-access')
  expect(JSON.parse(network.mock.calls[1][1].body)).toEqual({ refresh_token: 'synthetic-refresh' })
  expect(network.mock.calls[2][1].headers.Authorization).toBe('Bearer synthetic-rotated')
  expect((await readSession())?.user.id).toBe('A')
  expect((await readSession())?.access_token).toBe('synthetic-rotated')
  expect(remoteReady('A')).toBe(true)
})

test.each(['bad_jwt', 'session_not_found'])('a repeated user 403 %s after refresh does not loop or grant remote access', async code => {
  await rememberVerifiedCache(identityScope('A'))
  network.mockResolvedValueOnce(response(403, { error_code: code }))
    .mockResolvedValueOnce(response(200, session()))
    .mockResolvedValueOnce(response(403, { error_code: code }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('expired')
  expect(network).toHaveBeenCalledTimes(3); expect(remoteReady()).toBe(false)
  expect((await readSession())?.user.id).toBe('A')
})

test.each(['bad_jwt', 'session_not_found'])('fresh user identity mismatch after %s refresh cannot establish cache proof', async code => {
  network.mockResolvedValueOnce(response(403, { error_code: code }))
    .mockResolvedValueOnce(response(200, session()))
    .mockResolvedValueOnce(response(200, { id: 'B' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('expired')
  expect(network).toHaveBeenCalledTimes(3); expect(remoteReady()).toBe(false)
  expect(await trustedLocalCache(identityScope('A'))).toBe(false)
})

test.each(['bad_jwt', 'session_expired'])('user 403 %s followed by an account switch during refresh cannot save into the new owner', async code => {
  let finish!: (value: Response) => void
  network.mockResolvedValueOnce(response(403, { error_code: code }))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = verifySession(beginVerification('A'), new AbortController().signal)
  while (!finish) await Promise.resolve()
  await saveSession(session('B'))
  const saves = jest.mocked(Keychain.setGenericPassword).mock.calls.length
  finish(response(200, { ...session(), access_token: 'late-A' }))
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_SCOPE_CHANGED' })
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(saves)
  expect((await readSession())?.user.id).toBe('B'); expect(network).toHaveBeenCalledTimes(2)
})

test.each([400, 401, 403].flatMap(status =>
  ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'session_not_found'].map(code => [status, code] as const)))
('only explicit refresh failure %s/%s requires login and retains the exact safe code', async (status, code) => {
  network.mockResolvedValueOnce(response(status, { error_code: code, msg: 'synthetic server rejection' }))
  await expect(accessToken(true, 'A')).rejects.toMatchObject({ status: 401, details: { code } })
  expect(network).toHaveBeenCalledTimes(1)
  expect((await readSession())?.access_token).toBe('synthetic-access')
})

test.each([400, 401, 403].flatMap(status =>
  [undefined, 'user_banned', 'access_denied', 'unexpected_audience', 'bad_jwt'].map(code => [status, code] as const)))
('ambiguous refresh %s/%s retains the original ApiError status and details', async (status, code) => {
  network.mockResolvedValueOnce(response(status, { error_code: code, msg: 'synthetic policy failure' }))
  let failure: unknown
  try { await accessToken(true, 'A') } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(ApiError)
  expect(failure).toMatchObject({ status, message: 'synthetic policy failure' })
  expect((failure as ApiError).details?.code).toBe(code)
  expect(network).toHaveBeenCalledTimes(1)
  expect((await readSession())?.access_token).toBe('synthetic-access')
})

test.each([400, 401, 403])('refresh HTTP%s without a definite session code cannot falsely expire trusted local content', async status => {
  await rememberVerifiedCache(identityScope('A'))
  await Storage.setItem('vinote:A:note:draft', 'saved-draft')
  network.mockResolvedValueOnce(response(401, {})).mockResolvedValueOnce(response(status, {}))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('offline-known')
  expect(network).toHaveBeenCalledTimes(2); expect(remoteReady()).toBe(false)
  expect(await Storage.getItem('vinote:A:note:draft')).toBe('saved-draft')
  expect((await readSession())?.user.id).toBe('A')
})

test('an explicit user session error with refresh provider outage preserves cache and does not retry again', async () => {
  await rememberVerifiedCache(identityScope('A'))
  network.mockResolvedValueOnce(response(403, { error_code: 'session_not_found' }))
    .mockResolvedValueOnce(response(503, { error_code: 'session_not_found' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('offline-known')
  expect(network).toHaveBeenCalledTimes(2); expect(remoteReady()).toBe(false)
})

test('returned identity mismatch never opens the gate or creates cache proof', async () => {
  network.mockResolvedValueOnce(response(200, { id: 'B' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('expired')
  expect(remoteReady()).toBe(false); expect(await trustedLocalCache(identityScope('A'))).toBe(false)
})

test.each(['owner', 'authOrigin', 'integrationOrigin'])('a mismatched cache %s is never trusted', async field => {
  const scope = identityScope('A')
  await Storage.setItem('vinote:A:cache-scope', JSON.stringify({ version: 1, ...scope, [field]: 'different' }))
  expect(await trustedLocalCache(scope)).toBe(false)
})

test('successful verification establishes proof without reassigning old workspace Origin', async () => {
  await Storage.setItem('vinote:A:workspace', '{"serviceOrigin":"old-service","mappings":{},"cache":{}}')
  network.mockResolvedValueOnce(response(200, { id: 'A' }))
  await expect(verifySession(beginVerification('A'), new AbortController().signal)).resolves.toBe('verified')
  expect(await trustedLocalCache(identityScope('A'))).toBe(true)
  expect(await Storage.getItem('vinote:A:workspace')).toContain('old-service')
})

test('offline local edit preserves original history and baseline, with zero sync preparation', async () => {
  const note = { id: 'local', title: 'Synthetic', content: 'original', status: 'done', workspace_revision: 7,
    created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
  await Storage.setItem('vinote:A:note:local', JSON.stringify(note))
  await editNoteContent('local', 'offline edit', note, 'A')
  expect((await getNote('local')).content).toBe('offline edit')
  expect(JSON.parse((await Storage.getItem('vinote:A:note:local'))!).workspace_revision).toBe(7)
  expect(await Storage.getItem('vinote:A:note-history:local')).toContain('original')
  requestWorkspaceSync()
  await expect(syncWorkspace()).resolves.toBeUndefined()
  expect(FS.writeFile).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled()
})

test('queued workspace commit checks its original gate before pointer publication', async () => {
  grant(); const scope = captureRemoteScope('A'); let finish!: () => void
  jest.mocked(FS.writeFile).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined as never) }))
  const pending = writeWorkspace('A', { mappings: {}, cache: {} }, () => assertRemoteScope(scope))
  while (!finish) await Promise.resolve()
  pauseRemote(); grant(); finish()
  await expect(pending).rejects.toThrow()
  expect(await Storage.getItem('vinote:A:workspace-file')).toBeNull()
})

test('legacy Feishu queue stays owner-scoped and cannot POST even after verified retry', async () => {
  await queueAutomaticDelivery({ id: 'note', title: 'Synthetic', content: 'retained' }, 'A')
  grant(); await expect(flushAutomaticDeliveries()).rejects.toThrow('旧发布记录待核验')
  expect(await Storage.getItem('vinote:A:feishu-outbox:note')).toContain('retained')
  await saveSession(session('B')); await expect(flushAutomaticDeliveries()).resolves.toBeUndefined()
  expect(network).not.toHaveBeenCalled()
})
