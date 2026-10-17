import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { AppState, type AppStateStatus } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { useTrustedSession } from '../src/lib/useTrustedSession'
import { readAccountId } from '../src/lib/storage'
import { fetchMe } from '../src/lib/auth'
import { syncWorkspace } from '../src/lib/workspace'
import { rememberVerifiedCache } from '../src/lib/ownerCacheScope'
import { identityScope, remoteReady, pauseRemote } from '../src/lib/sessionGate'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { ApiError } from '../src/lib/errors'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
jest.mock('../src/lib/auth', () => ({ fetchMe: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ syncWorkspace: jest.fn(async () => {}) }))
let result: ReturnType<typeof useTrustedSession>, view: Renderer.ReactTestRenderer
let foreground: (value: AppStateStatus) => void
function Harness() { result = useTrustedSession(); return null }
beforeEach(async () => {
  jest.clearAllMocks(); transitionIdentity('A'); jest.mocked(readAccountId).mockResolvedValue('A')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { foreground = callback; return { remove: jest.fn() } })
  jest.mocked(fetchMe).mockReset()
})
afterEach(() => { if (view) act(() => view.unmount()); pauseRemote(); jest.useRealTimers(); jest.restoreAllMocks() })
const mount = async () => { await act(async () => { view = Renderer.create(<Harness />) }) }

test('trusted cache becomes readable before identity request settles; no sync yet', async () => {
  await rememberVerifiedCache(identityScope('A'))
  let finish!: (value: any) => void
  jest.mocked(fetchMe).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  expect(result.readable).toBe(true); expect(result.mode).toBe('checking'); expect(remoteReady()).toBe(false)
  expect(result.message).toBe('正在连接账号服务…')
  expect(syncWorkspace).not.toHaveBeenCalled()
  await act(async () => { finish({ id: 'A' }) })
  expect(result.mode).toBe('verified'); expect(syncWorkspace).not.toHaveBeenCalled()
  expect(fetchMe).toHaveBeenCalledTimes(1)
})

test('eight second deadline aborts actual verifier signal; trusted content stays readable', async () => {
  jest.useFakeTimers(); await rememberVerifiedCache(identityScope('A'))
  let signal!: AbortSignal
  jest.mocked(fetchMe).mockImplementationOnce(context => new Promise((_resolve, reject) => {
    signal = context!.signal; signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  await mount(); await act(async () => { jest.advanceTimersByTime(8000) })
  expect(signal.aborted).toBe(true); expect(result.readable).toBe(true)
  expect(result.mode).toBe('offline-known'); expect(syncWorkspace).not.toHaveBeenCalled()
  expect(result.message).toBe('暂时无法连接账号服务，已保存内容仍可查看。')
})

test('no proof plus outage is an explicit unverified screen, never an empty library', async () => {
  jest.mocked(fetchMe).mockRejectedValue(new ApiError('unavailable', 503))
  await mount(); expect(result.readable).toBeNull(); expect(result.message).toBe('暂时无法连接账号服务，请稍后重试。')
  expect(result.mode).toBe('checking'); expect(syncWorkspace).not.toHaveBeenCalled()
})

test('manual retry only verifies, foreground verifies identity without starting synchronization', async () => {
  await rememberVerifiedCache(identityScope('A'))
  jest.mocked(fetchMe).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'A' } as any)
  await mount(); expect(result.mode).toBe('offline-known')
  await act(async () => result.retry())
  expect(result.mode).toBe('verified'); expect(syncWorkspace).not.toHaveBeenCalled()
  await act(async () => foreground('background'))
  expect(remoteReady()).toBe(false); expect(result.readable).toBe(true)
  await act(async () => foreground('active'))
  expect(fetchMe).toHaveBeenCalledTimes(3); expect(syncWorkspace).not.toHaveBeenCalled()
})

test('401 retains trusted local view and offers re-login without clearing drafts', async () => {
  await rememberVerifiedCache(identityScope('A')); await Storage.setItem('vinote:A:local-draft', 'draft')
  jest.mocked(fetchMe).mockRejectedValue(new ApiError('expired', 401))
  await mount(); expect(result.mode).toBe('expired'); expect(result.readable).toBe(true)
  expect(result.message).toBe('登录已过期，已保存内容不受影响。')
  await act(async () => result.showLogin())
  expect(result.readable).toBe(false); expect(await Storage.getItem('vinote:A:local-draft')).toBe('draft')
  expect(remoteReady()).toBe(false)
})

test('account change rejects late A result and prevents A sync under B', async () => {
  await rememberVerifiedCache(identityScope('A'))
  let finish!: (value: any) => void
  jest.mocked(fetchMe).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockRejectedValue(new Error('B offline'))
  await mount()
  await act(async () => { jest.mocked(readAccountId).mockResolvedValue('B'); transitionIdentity('B') })
  await act(async () => { finish({ id: 'A' }) })
  expect(result.readable).toBeNull(); expect(remoteReady()).toBe(false); expect(syncWorkspace).not.toHaveBeenCalled()
})

test('running scope survives actual background foreground reverify but unknown owner read revokes it', async () => {
  jest.mocked(fetchMe).mockResolvedValue({ id: 'A' } as any)
  await mount()
  const { captureStreamScope, assertStreamScope } = require('../src/lib/sessionGate')
  const scope = captureStreamScope('A')
  await act(async () => foreground('background'))
  expect(() => assertStreamScope(scope)).not.toThrow()
  await act(async () => foreground('active'))
  expect(() => assertStreamScope(scope)).not.toThrow()
  jest.mocked(readAccountId).mockRejectedValueOnce(new Error('storage unavailable'))
  await act(async () => result.retry())
  expect(() => assertStreamScope(scope)).toThrow()
})
