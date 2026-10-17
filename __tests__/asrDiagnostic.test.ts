import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { createPcmReader } from '../src/lib/nativePcmReader'
import { recognizeInterval } from '../src/lib/asrStream'
import { ASRServiceFailure, readASRDiagnostic, withASRDiagnostic } from '../src/lib/asrFailure'
import { TransportError } from '../src/lib/errors'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(async () => ({ expires_at: Date.now() / 1000 + 3600 })) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'synthetic-token') }))
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
// LAST is enqueued after paced audio; finalization has its own budget from that ACK.
const expireFinalization = async () => {
  await jest.advanceTimersByTimeAsync(600)
  await jest.advanceTimersByTimeAsync((.6 * 1.5 + 90) * 1000)
}
const pcm = (bytes: number) => 'AAAA'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : '')
class Socket {
  static current: Socket
  sent: unknown[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: (event?: { code?: unknown; reason?: string }) => void
  onerror?: () => void
  constructor() { Socket.current = this }
  send(value: unknown) { this.sent.push(value) }
  close() { this.onclose?.({ code: 1000, reason: 'PRIVATE_CLOSE_REASON' }) }
  event(value: object) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
beforeEach(() => {
  jest.useFakeTimers(); transitionIdentity('owner'); finishVerification(beginVerification('owner'), 'verified')
  globalThis.WebSocket = Socket as never
  FS.read = jest.fn(async (_path, bytes = 0) => pcm(bytes))
  NativeModules.MeetingAudio = {
    openPcmReader: jest.fn(async () => 'PRIVATE_HANDLE'),
    readPcmReader: jest.fn(async (_handle, _position, bytes) => pcm(bytes)),
    closePcmReader: jest.fn(async () => {}),
  }
})
afterEach(() => jest.useRealTimers())
async function start(end = .6) {
  const result = recognizeInterval('file:///PRIVATE_PATH.wav', 'frozen-model', 0, end, 'owner', async () => {}, jest.fn())
  const caught = result.catch(error => error)
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  return { result, caught, socket: Socket.current }
}

test.each(['server_error', 'socket_error', 'socket_close', 'deadline'] as const)('failed reader cleanup preserves %s first cause and frozen diagnostics', async origin => {
  const { caught, socket } = await start()
  NativeModules.MeetingAudio.closePcmReader.mockRejectedValue(new Error('PRIVATE_CLEANUP_TOKEN_BODY'))
  if (origin === 'server_error') socket.event({ type: 'session.error', code: 'unknown_result' })
  if (origin === 'socket_error') socket.onerror?.()
  if (origin === 'socket_close') socket.onclose?.({ code: 1006, reason: 'PRIVATE_REASON' })
  if (origin === 'deadline') await expireFinalization()
  const error = await caught
  expect(error).toBeInstanceOf(ASRServiceFailure)
  expect(error.code).toBe('unknown_result')
  expect(readASRDiagnostic(error)).toMatchObject({ origin, category: 1, audioAttempted: 1,
    submittedFrames: origin === 'deadline' ? 3 : 1 })
  expect(Object.isFrozen(readASRDiagnostic(error))).toBe(true)
  expect(error.message + JSON.stringify(readASRDiagnostic(error))).not.toContain('PRIVATE')
  expect(NativeModules.MeetingAudio.closePcmReader).toHaveBeenCalledTimes(1)
})

test('failed reader cleanup preserves gate rejection without inventing ASR diagnostics', async () => {
  const { caught } = await start()
  NativeModules.MeetingAudio.closePcmReader.mockRejectedValue(new Error('PRIVATE_CLEANUP'))
  finishVerification(beginVerification('owner'), 'offline-known')
  const error = await caught
  expect(error.code).toBe('SESSION_NOT_VERIFIED')
  expect(readASRDiagnostic(error)).toBeUndefined()
})

test('failed reader cleanup before audio preserves bounded transport classification', async () => {
  let release!: (value: string) => void
  NativeModules.MeetingAudio.readPcmReader.mockImplementationOnce(async () => new Promise(resolve => { release = resolve }))
  const { caught, socket } = await start()
  NativeModules.MeetingAudio.closePcmReader.mockRejectedValue(new Error('PRIVATE_CLEANUP'))
  socket.onerror?.()
  const error = await caught
  expect(error).toBeInstanceOf(TransportError)
  expect(readASRDiagnostic(error)).toMatchObject({ origin: 'socket_error', audioAttempted: 0, submittedFrames: 0 })
  release(pcm(6400)); await flush()
  expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
})

test('final cannot succeed when reader cleanup is unconfirmed; cleanup body is discarded', async () => {
  const { caught, socket } = await start(.1)
  NativeModules.MeetingAudio.closePcmReader.mockRejectedValue(new Error('PRIVATE_CLEANUP_TOKEN_BODY'))
  socket.event({ type: 'asr.final', text: 'confirmed' })
  const error = await caught
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe('PCM_READER_CLOSE_FAILED')
  expect(readASRDiagnostic(error)).toBeUndefined()
})

test('read plus cleanup failure preserves exact original read error object', async () => {
  const original = new Error('PCM_READ_INCOMPLETE')
  NativeModules.MeetingAudio.readPcmReader.mockRejectedValue(original)
  NativeModules.MeetingAudio.closePcmReader.mockRejectedValue(new Error('PRIVATE_CLEANUP'))
  const reader = createPcmReader('file:///private.wav', 0, 2, () => {})
  await expect(reader.read(2)).rejects.toBe(original)
  // Repeated close still reports the release failure; it is not claimed successful.
  await expect(reader.close()).rejects.toThrow('PRIVATE_CLEANUP')
  expect(NativeModules.MeetingAudio.closePcmReader).toHaveBeenCalledTimes(1)
})
test.each(['server_error', 'socket_error', 'socket_close', 'deadline'] as const)('records exact %s and first cause before own close', async origin => {
  const { caught, socket } = await start()
  if (origin === 'server_error') socket.event({ type: 'session.error', code: 'unknown_result', text: 'PRIVATE_TEXT', message: 'PRIVATE_REASON', id: 'PRIVATE_ID' })
  if (origin === 'socket_error') socket.onerror?.()
  if (origin === 'socket_close') socket.onclose?.({ code: 1006, reason: 'PRIVATE_REASON' })
  if (origin === 'deadline') await expireFinalization()
  const error = await caught, diagnostic = readASRDiagnostic(error)
  expect(error).toBeInstanceOf(ASRServiceFailure)
  expect(diagnostic).toMatchObject({ origin, category: 1, readerMode: 1, audioAttempted: 1,
    submittedBytes: origin === 'deadline' ? 19200 : 6400, submittedFrames: origin === 'deadline' ? 3 : 1,
    nativeReadBytes: origin === 'deadline' ? 19200 : 6400, nativeReadCount: origin === 'deadline' ? 3 : 1,
    sentComplete: origin === 'deadline' ? 1 : 0 })
  if (origin === 'socket_close') expect(diagnostic?.closeCode).toBe(1006)
  else expect(diagnostic?.closeCode).toBeUndefined()
  expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|frozen-model/)
  expect(Object.isFrozen(diagnostic)).toBe(true)
})
test.each([undefined, '1006', 999, 5000, 1006.5, NaN, Infinity])('omits invalid close code %s', async code => {
  const { caught, socket } = await start(); socket.onclose?.({ code })
  expect(readASRDiagnostic(await caught)?.closeCode).toBeUndefined()
})
test('native read completed but throwing bridge send is not counted submitted and stays unknown', async () => {
  const result = recognizeInterval('file:///private.wav', 'frozen-model', 0, .1, 'owner', async () => {}, jest.fn())
  const caught = result.catch(error => error); await flush()
  Socket.current.send = () => { throw new Error('PRIVATE_SEND_ERROR') }
  Socket.current.event({ type: 'session.started' }); await flush()
  const error = await caught
  expect(error).toBeInstanceOf(ASRServiceFailure)
  expect(readASRDiagnostic(error)).toMatchObject({ origin: 'send_error', submittedBytes: 0, submittedFrames: 0,
    nativeReadBytes: 3200, nativeReadCount: 1, sentComplete: 0, audioAttempted: 1 })
  expect(JSON.stringify(readASRDiagnostic(error))).not.toContain('PRIVATE')
})
test('pending read and late completion cannot advance a captured failure snapshot', async () => {
  let release!: (value: string) => void
  NativeModules.MeetingAudio.readPcmReader.mockImplementationOnce(async () => new Promise(resolve => { release = resolve }))
  const { caught, socket } = await start(); socket.onclose?.({ code: 1006 })
  const diagnostic = readASRDiagnostic(await caught)
  expect(diagnostic).toMatchObject({ nativeReadCount: 0, submittedFrames: 0 })
  release(pcm(6400)); await flush()
  expect(diagnostic).toMatchObject({ nativeReadCount: 0, submittedFrames: 0 })
  expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
})
test('native read rejection is send_error without copying native message', async () => {
  NativeModules.MeetingAudio.readPcmReader.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_ERROR'))
  const { caught } = await start()
  const diagnostic = readASRDiagnostic(await caught)
  expect(diagnostic).toMatchObject({ origin: 'send_error', nativeReadBytes: 0, submittedBytes: 0 })
  expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE')
})
test('legacy reader has explicit mode and zero native counts, successful submitted counts', async () => {
  NativeModules.MeetingAudio = {}; const { caught, socket } = await start(.1); socket.onerror?.()
  expect(readASRDiagnostic(await caught)).toMatchObject({ readerMode: 0, nativeReadBytes: 0, nativeReadCount: 0,
    submittedBytes: 3200, submittedFrames: 1, sentComplete: 1 })
})
test('per-attempt cumulative counters never use partial coverage or a previous attempt', async () => {
  const first = await start()
  first.socket.event({ type: 'asr.partial', audioMs: 599, text: 'PRIVATE_PARTIAL' })
  await jest.advanceTimersByTimeAsync(200)
  first.socket.event({ type: 'asr.partial', audioMs: 1 })
  first.socket.onerror?.()
  expect(readASRDiagnostic(await first.caught)).toMatchObject({ submittedBytes: 12800, submittedFrames: 2,
    nativeReadBytes: 12800, nativeReadCount: 2, sentComplete: 0 })
  const next = await start(); next.socket.onerror?.()
  expect(readASRDiagnostic(await next.caught)).toMatchObject({ submittedBytes: 6400, nativeReadBytes: 6400 })
})
test('same owner renewal continues; failed verification keeps gate error rather than invented socket origin', async () => {
  const { caught, socket } = await start()
  pauseRemote(); finishVerification(beginVerification('owner'), 'verified')
  await jest.advanceTimersByTimeAsync(200)
  expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(2)
  finishVerification(beginVerification('owner'), 'offline-known')
  const error = await caught
  expect(error.code).toBe('SESSION_NOT_VERIFIED'); expect(readASRDiagnostic(error)).toBeUndefined()
})
test('pre-audio socket failure stays TransportError and finalPending close cannot interfere with verified final', async () => {
  const first = recognizeInterval('file:///private.wav', 'frozen-model', 0, .1, 'owner', async () => {}, jest.fn())
  const caught = first.catch(error => error); await flush(); Socket.current.onerror?.()
  const error = await caught; expect(error).toBeInstanceOf(TransportError)
  expect(readASRDiagnostic(error)).toMatchObject({ origin: 'socket_error', audioAttempted: 0, submittedBytes: 0 })
  const next = await start(.1); pauseRemote(); next.socket.event({ type: 'asr.final', text: 'confirmed' })
  next.socket.onclose?.({ code: 1006 }); next.socket.onerror?.()
  finishVerification(beginVerification('owner'), 'verified')
  await expect(next.result).resolves.toBe('confirmed')
})
test('unknown origin/count/code input is projected, without extra properties or changing error identity', () => {
  const error = new TransportError('unchanged')
  const input = { origin: 'PRIVATE_ORIGIN', closeCode: 'PRIVATE_CODE', readerMode: 1 as const,
    submittedBytes: Infinity, submittedFrames: -1, nativeReadBytes: 1.5, nativeReadCount: Number.MAX_SAFE_INTEGER + 1,
    reason: 'PRIVATE_REASON', token: 'PRIVATE_TOKEN' }
  expect(withASRDiagnostic(error, input, false, false)).toBe(error)
  expect(readASRDiagnostic(error)).toEqual({ category: 0, stage: 2, audioAttempted: 0, sentComplete: 0,
    readerMode: 1, submittedBytes: 0, submittedFrames: 0, nativeReadBytes: 0, nativeReadCount: 0 })
})
