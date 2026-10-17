import * as Keychain from 'react-native-keychain'
import { clearToken, readSession, saveSession, sessionRevision, type Session } from '../src/lib/storage'
import { identityEpoch, identityOwner, SessionScopeChangedError } from '../src/lib/sessionIdentity'
import { assertIdentity, identityScope } from '../src/lib/sessionGate'
import { accessToken } from '../src/lib/supabase'

const account = (id: string, token = id): Session => ({ access_token: token, refresh_token: 'synthetic-refresh', expires_at: 9999999999, user: { id, email: `${id}@example.invalid` } })
const credentials = (session: Session | null): false | Keychain.UserCredentials => session ? { service: 'test', username: session.user.id, password: JSON.stringify(session), storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE } : false
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
let stored: Session | null = null
beforeEach(async () => {
  jest.mocked(Keychain.resetGenericPassword).mockImplementation(async () => { stored = null; return true })
  await clearToken()
  jest.clearAllMocks()
  jest.mocked(Keychain.setGenericPassword).mockImplementation(async (_name, password) => { stored = JSON.parse(password); return false })
  jest.mocked(Keychain.getGenericPassword).mockImplementation(async () => credentials(stored))
  await saveSession(account('A', 'old-A'))
})
afterEach(() => { jest.restoreAllMocks() })

function delayedRead() {
  const entered = deferred<void>(), release = deferred<void>()
  jest.mocked(Keychain.getGenericPassword).mockImplementationOnce(async () => {
    const snapshot = credentials(stored)
    entered.resolve(); await release.promise
    return snapshot
  })
  return { entered, release }
}

test('delayed native GET plus same-account refresh is serialized without identity failure', async () => {
  const gate = delayedRead(), epoch = identityEpoch(), revision = sessionRevision()
  const reading = readSession()
  await gate.entered.promise
  const scope = identityScope('A')
  const writing = saveSession(account('A', 'new-A'), { refresh: true, guard: () => assertIdentity(scope) })
  expect(sessionRevision()).toBe(revision + 1)
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1)
  gate.release.resolve()
  expect((await reading)?.access_token).toBe('old-A')
  await writing
  expect((await readSession())?.access_token).toBe('new-A')
  expect(identityEpoch()).toBe(epoch)
  expect(identityOwner()).toBe('A')
  expect(sessionRevision()).toBe(revision + 1)
})

test('real account switch invalidates a delayed GET and never returns old credentials', async () => {
  const gate = delayedRead()
  const reading = readSession()
  const rejected = expect(reading).rejects.toBeInstanceOf(SessionScopeChangedError)
  await gate.entered.promise
  const writing = saveSession(account('B'))
  gate.release.resolve()
  await rejected; await writing
  expect((await readSession())?.user.id).toBe('B')
})

test('A-B-A keeps owner equal but rejects the earlier read epoch', async () => {
  const gate = delayedRead(), epoch = identityEpoch()
  const reading = readSession()
  const rejected = expect(reading).rejects.toBeInstanceOf(SessionScopeChangedError)
  await gate.entered.promise
  const toB = saveSession(account('B'))
  const toA = saveSession(account('A', 'returned-A'))
  expect(identityOwner()).toBe('A')
  expect(identityEpoch()).toBeGreaterThan(epoch)
  gate.release.resolve()
  await rejected; await Promise.all([toB, toA])
  expect((await readSession())?.access_token).toBe('returned-A')
})

test('logout during native GET rejects credentials and queue remains usable', async () => {
  const gate = delayedRead()
  const reading = readSession()
  const rejected = expect(reading).rejects.toBeInstanceOf(SessionScopeChangedError)
  await gate.entered.promise
  const clearing = clearToken()
  gate.release.resolve()
  await rejected; await clearing
  expect(await readSession()).toBeNull()
})

test('two native reads cannot overlap and do not advance write revision', async () => {
  const gate = delayedRead(), revision = sessionRevision()
  const first = readSession()
  await gate.entered.promise
  const second = readSession()
  await Promise.resolve()
  expect(Keychain.getGenericPassword).toHaveBeenCalledTimes(1)
  gate.release.resolve()
  expect((await first)?.user.id).toBe('A')
  expect((await second)?.user.id).toBe('A')
  expect(sessionRevision()).toBe(revision)
})

test('native read failure is visible and does not poison the read/write queue', async () => {
  jest.mocked(Keychain.getGenericPassword).mockRejectedValueOnce(new Error('synthetic native failure'))
  await expect(readSession()).rejects.toThrow('synthetic native failure')
  await saveSession(account('A', 'new-A'), { refresh: true, guard: () => assertIdentity(identityScope('A')) })
  expect((await readSession())?.access_token).toBe('new-A')
})

test('stored owner mismatch is not accepted and does not adopt a new identity', async () => {
  stored = account('B')
  await expect(readSession()).rejects.toBeInstanceOf(SessionScopeChangedError)
  expect(identityOwner()).toBe('A')
})

test('actual refresh response cannot overwrite a newer same-account credential mutation', async () => {
  const requested = deferred<void>(), response = deferred<Response>()
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => { requested.resolve(); return response.promise })
  const refresh = accessToken(true, 'A')
  const rejected = expect(refresh).rejects.toBeInstanceOf(SessionScopeChangedError)
  await requested.promise
  const revision = sessionRevision()
  const scope = identityScope('A')
  await saveSession(account('A', 'newer-A'), { refresh: true, guard: () => assertIdentity(scope) })
  expect(sessionRevision()).toBe(revision + 1)
  response.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(account('A', 'stale-refresh')) } as unknown as Response)
  await rejected
  expect((await readSession())?.access_token).toBe('newer-A')
  fetchSpy.mockRestore()
})
