import deployment from '../config/deployment.json'
import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { createPcmReader } from '../src/lib/nativePcmReader'
import { recognizeInterval } from '../src/lib/asrStream'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(async () => ({ expires_at: 9999999999 })) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'synthetic-token') }))

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const pcm = (bytes: number) => 'AAAA'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : '')
const native = () => ({ openPcmReader: jest.fn(async () => 'opaque'), readPcmReader: jest.fn(async (_h, _p, bytes) => pcm(bytes)), closePcmReader: jest.fn(async () => {}) })
class Socket {
  static current: Socket
  sent: unknown[] = []
  onopen?: () => void; onclose?: () => void; onerror?: () => void
  onmessage?: (event: { data: string }) => void
  constructor() { Socket.current = this }
  send(data: unknown) { this.sent.push(data) }
  close() { this.onclose?.() }
  event(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
beforeEach(() => {
  transitionIdentity('owner'); finishVerification(beginVerification('owner'), 'verified')
  NativeModules.MeetingAudio = native()
  FS.read = jest.fn(async (_p, bytes = 0) => pcm(bytes))
  globalThis.WebSocket = Socket as never
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

test('one open and sequential bounded native reads, idempotent close', async () => {
  const m = NativeModules.MeetingAudio
  const reader = createPcmReader('file:///cache/asr-a.wav', 2, 6404, () => {})
  expect(reader.mode).toBe('native-session')
  await reader.read(6400); await reader.read(2); await reader.close(); await reader.close()
  expect(m.openPcmReader).toHaveBeenCalledTimes(1)
  expect(m.readPcmReader.mock.calls).toEqual([['opaque', 2, 6400], ['opaque', 6402, 2]])
  expect(m.closePcmReader).toHaveBeenCalledTimes(1)
  expect(FS.read).not.toHaveBeenCalled()
})

test('cancel while open pending waits for late handle and closes it without read', async () => {
  const m = NativeModules.MeetingAudio, open = deferred<string>()
  m.openPcmReader.mockReturnValueOnce(open.promise)
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 2, () => {})
  const reading = reader.read(2), failure = expect(reading).rejects.toThrow('CLOSED')
  let closed = false; const closing = reader.close().then(() => { closed = true })
  await flush(); expect(closed).toBe(false)
  open.resolve('late'); await closing; await failure
  expect(m.closePcmReader).toHaveBeenCalledWith('late'); expect(m.readPcmReader).not.toHaveBeenCalled()
})

test('scope changes during native read discard result and close', async () => {
  const m = NativeModules.MeetingAudio, pending = deferred<string>()
  let changed = false
  m.readPcmReader.mockReturnValueOnce(pending.promise)
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 2, () => { if (changed) throw new Error('scope') })
  const result = reader.read(2), failure = expect(result).rejects.toThrow('scope')
  await flush(); changed = true; pending.resolve(pcm(2)); await failure
  expect(m.closePcmReader).toHaveBeenCalledTimes(1)
})

test('short native read fails and closes without falling back', async () => {
  const m = NativeModules.MeetingAudio; m.readPcmReader.mockResolvedValueOnce('AA==')
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 2, () => {})
  await expect(reader.read(2)).rejects.toThrow('INCOMPLETE')
  expect(m.closePcmReader).toHaveBeenCalledTimes(1); expect(FS.read).not.toHaveBeenCalled()
})

test.each([{}, { openPcmReader: jest.fn() }])('legacy incomplete native capability stays explicit RNFS fallback', async module => {
  NativeModules.MeetingAudio = module
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 2, () => {})
  expect(reader.mode).toBe('legacy-rnfs'); await reader.read(2); await reader.close()
  expect(FS.read).toHaveBeenCalledWith('/cache/asr-a.wav', 2, 44, 'base64')
})

test('native open rejection does not silently fall back', async () => {
  NativeModules.MeetingAudio.openPcmReader.mockRejectedValueOnce(new Error('native failed'))
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 2, () => {})
  await expect(reader.read(2)).rejects.toThrow('native failed'); expect(FS.read).not.toHaveBeenCalled()
})

test('native final closes before successful recognition settles', async () => {
  const m = NativeModules.MeetingAudio
  const result = recognizeInterval('file:///cache/asr-a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn())
  await flush(); Socket.current.event({ type: 'session.started' }); await flush()
  expect(Socket.current.sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(1)
  Socket.current.event({ type: 'asr.final', text: 'synthetic final' })
  await expect(result).resolves.toBe('synthetic final'); expect(m.closePcmReader).toHaveBeenCalledTimes(1)
})

test.each(['owner', 'expired', 'cancel', 'origin'])('pending read on %s invalidation never sends late frame', async reason => {
  const m = NativeModules.MeetingAudio, pending = deferred<string>(), controller = new AbortController()
  m.readPcmReader.mockReturnValueOnce(pending.promise)
  const result = recognizeInterval('file:///cache/asr-a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn(), controller.signal)
  const failure = expect(result).rejects.toThrow()
  await flush(); const socket = Socket.current; socket.event({ type: 'session.started' }); await flush()
  if (reason === 'owner') { transitionIdentity('other'); transitionIdentity('owner') }
  if (reason === 'expired') pauseRemote('expired')
  if (reason === 'cancel') controller.abort()
  const originalOrigin = deployment.integrationBaseUrl
  if (reason === 'origin') deployment.integrationBaseUrl += '/changed'
  pending.resolve(pcm(3200)); await failure; await flush()
  deployment.integrationBaseUrl = originalOrigin
  expect(socket.sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(0)
  expect(m.closePcmReader).toHaveBeenCalledTimes(1)
})

test('cleanup failure rejects successful final rather than pretending release', async () => {
  const m = NativeModules.MeetingAudio
  const result = recognizeInterval('file:///cache/asr-a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toThrow('CLOSE_FAILED')
  await flush(); Socket.current.event({ type: 'session.started' }); await flush()
  m.closePcmReader.mockRejectedValueOnce(new Error('synthetic release failure'))
  Socket.current.event({ type: 'asr.final', text: 'synthetic final' }); await failure
})


test('concurrent reads do not queue another native read', async () => {
  const m = NativeModules.MeetingAudio, pending = deferred<string>()
  m.readPcmReader.mockReturnValueOnce(pending.promise)
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 4, () => {})
  const first = reader.read(2); await flush()
  await expect(reader.read(2)).rejects.toThrow('CONCURRENT')
  expect(m.readPcmReader).toHaveBeenCalledTimes(1)
  pending.resolve(pcm(2)); await first; await reader.close()
})

test('oversized JS frame fails without native open', async () => {
  const m = NativeModules.MeetingAudio
  const reader = createPcmReader('file:///cache/asr-a.wav', 0, 12800, () => {})
  await expect(reader.read(6402)).rejects.toThrow('INVALID')
  expect(m.openPcmReader).not.toHaveBeenCalled()
})

test('native pending read survives checking and same-owner renewal; final still waits for verified', async () => {
  const m = NativeModules.MeetingAudio, pending = deferred<string>()
  m.readPcmReader.mockReturnValueOnce(pending.promise)
  const result = recognizeInterval('file:///cache/asr-a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn())
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  pauseRemote(); const ticket = beginVerification('owner')
  pending.resolve(pcm(3200)); await flush()
  expect(Socket.current.sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(1)
  Socket.current.event({ type: 'asr.final', text: 'confirmed' }); Socket.current.close(); Socket.current.onerror?.()
  await flush(); expect(m.closePcmReader).not.toHaveBeenCalled()
  finishVerification(ticket, 'verified')
  await expect(result).resolves.toBe('confirmed')
  expect(m.closePcmReader).toHaveBeenCalledTimes(1)
})
