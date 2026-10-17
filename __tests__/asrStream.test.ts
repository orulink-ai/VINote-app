import { ASRServiceFailure } from '../src/lib/asrFailure'
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native'
import { readASRDiagnostic } from '../src/lib/asrFailure'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
import FS from 'react-native-fs'
import { recognizeInterval, pcmFrame, durationLimit } from '../src/lib/asrStream'
import { retry } from '../src/lib/processingHelpers'
jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(async () => ({ expires_at: Date.now() / 1000 + 3600 })) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'test-only-token') }))

class Socket {
  static current: Socket
  sent: unknown[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  url: string
  constructor(url = '') { Socket.current = this; this.url = url }
  send(value: unknown) { this.sent.push(value) }
  close() { this.onclose?.() }
  event(value: object) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
beforeEach(() => {
  NativeModules.MeetingAudio = {}
  transitionIdentity('owner')
  finishVerification(beginVerification('owner'), 'verified')
  jest.useFakeTimers()
  globalThis.WebSocket = Socket as never
  FS.read = jest.fn(async (_path, bytes = 0) => 'AAAA'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : ''))
})
afterEach(() => jest.useRealTimers())

test('Android pre-audio native failure never enters the legacy transport retry path', async () => {
  const previousOS = Platform.OS
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  let id = ''
  const native = {
    protocolVersion: 1, addListener: jest.fn(), removeListeners: jest.fn(),
    connect: jest.fn(async (value: string) => { id = value }), enqueue: jest.fn(), close: jest.fn(async () => {}),
  }
  NativeModules.VINoteASRTransport = native
  try {
    const result = retry(() => recognizeInterval('file:///a.wav', 'frozen-model', 0, 1, 'owner', async () => {}, jest.fn()), async () => {}, jest.fn())
      .catch(error => error)
    await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'error', category: 3 })
    expect(await result).toMatchObject({ code: 'unknown_result' })
    await jest.advanceTimersByTimeAsync(10000)
    expect(native.connect).toHaveBeenCalledTimes(1)
    expect(native.enqueue).not.toHaveBeenCalled()
  } finally {
    delete NativeModules.VINoteASRTransport
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS })
  }
})

test('Android enqueue refusal stops the real sender, preserves first failure and waits for socket cleanup', async () => {
  const previousOS = Platform.OS
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  let id = '', finishClose!: () => void
  const native = {
    protocolVersion: 1, addListener: jest.fn(), removeListeners: jest.fn(),
    connect: jest.fn(async (value: string) => { id = value }),
    enqueue: jest.fn(async (_id: string, _data: string, binary: boolean) => ({ accepted: !binary, queueBytes: 0 })),
    close: jest.fn(() => new Promise<void>(resolve => { finishClose = resolve })),
  }
  NativeModules.VINoteASRTransport = native
  try {
    const onFailure = jest.fn()
    let observed: unknown
    const result = retry(() => recognizeInterval('file:///a.wav', 'frozen-model', 0, 1, 'owner', async () => {}, jest.fn(), undefined, onFailure), async () => {}, jest.fn())
      .catch(error => { observed = error; return error })
    await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'open' }); await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'message', data: JSON.stringify({ type: 'session.started' }) }); await flush()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(observed).toBeUndefined()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'error', category: 3 })
    await jest.advanceTimersByTimeAsync(10000)
    expect(native.enqueue).toHaveBeenCalledTimes(2) // One session.start and one rejected frame; no replay.
    expect(native.connect).toHaveBeenCalledTimes(1)
    expect(observed).toBeUndefined()
    finishClose()
    const error = await result
    expect(readASRDiagnostic(error)).toMatchObject({ transportMode: 1, transportFailure: 1, submittedBytes: 0, submittedFrames: 0, sentComplete: 0 })
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(native.close).toHaveBeenCalledTimes(1)
  } finally {
    delete NativeModules.VINoteASRTransport
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS })
  }
})

test.each(['accept', 'reject', 'identity', 'deadline', 'peer-close-accept', 'peer-close-reject', 'peer-close-deadline'] as const)('final before Android LAST ACK: %s cannot bypass ACK, scope or deadline', async outcome => {
  const previousOS = Platform.OS
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  let id = '', acknowledgeLast!: (ack: { accepted: boolean; queueBytes: number }) => void
  const native = {
    protocolVersion: 1, addListener: jest.fn(), removeListeners: jest.fn(),
    connect: jest.fn(async (value: string) => { id = value }),
    enqueue: jest.fn(async (_id: string, _data: string, binary: boolean) => binary
      ? new Promise<{ accepted: boolean; queueBytes: number }>(resolve => { acknowledgeLast = resolve })
      : { accepted: true, queueBytes: 0 }),
    close: jest.fn(async () => {}),
  }
  NativeModules.VINoteASRTransport = native
  try {
    let settled = false
    const result = recognizeInterval('file:///a.wav', 'frozen-model', 0, .1, 'owner', async () => {}, jest.fn())
      .then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
    await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'open' }); await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'message', data: JSON.stringify({ type: 'session.started' }) }); await flush()
    expect(native.enqueue).toHaveBeenCalledTimes(2)
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'message', data: JSON.stringify({ type: 'asr.final', text: 'confirmed' }) }); await flush()
    if (outcome.startsWith('peer-close')) {
      DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'peerClosing', code: 1000, reason: 'SYNTHETIC_SECRET' })
      DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'closed' }); await flush()
    }
    expect(settled).toBe(false)
    expect(jest.getTimerCount()).toBeGreaterThan(0)
    if (outcome === 'identity') transitionIdentity('other')
    if (outcome.endsWith('deadline')) await jest.advanceTimersByTimeAsync(90150)
    acknowledgeLast({ accepted: !outcome.endsWith('reject'), queueBytes: 0 })
    const observed = await result
    if (outcome.endsWith('accept')) expect(observed).toEqual({ value: 'confirmed' })
    else {
      expect(observed).toHaveProperty('error')
      expect(observed).not.toHaveProperty('value')
    }
    expect(native.enqueue).toHaveBeenCalledTimes(2)
    expect(native.connect).toHaveBeenCalledTimes(1)
    expect(native.close).toHaveBeenCalledTimes(1)
  } finally {
    delete NativeModules.VINoteASRTransport
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS })
  }
})

test.each(['late-final', 'no-progress', 'unconfirmed-LAST'] as const)('separate upload/final deadlines: %s', async outcome => {
  const previousOS = Platform.OS
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  const budget = 90150 // 0.1 seconds of PCM: 1.5D + 90 seconds per phase.
  const timers = jest.spyOn(globalThis, 'setTimeout')
  const budgetArms = () => timers.mock.calls.filter(call => call[1] === budget).length
  let id = '', acknowledgeLast!: (ack: { accepted: boolean; queueBytes: number }) => void
  const native = {
    protocolVersion: 1, addListener: jest.fn(), removeListeners: jest.fn(),
    connect: jest.fn(async (value: string) => { id = value }),
    enqueue: jest.fn(async (_id: string, _data: string, binary: boolean) => binary
      ? new Promise<{ accepted: boolean; queueBytes: number }>(resolve => { acknowledgeLast = resolve })
      : { accepted: true, queueBytes: 0 }),
    close: jest.fn(async () => {}),
  }
  NativeModules.VINoteASRTransport = native
  try {
    let settled = false
    const failure = jest.fn()
    const result = recognizeInterval('file:///synthetic.wav', 'frozen-model', 0, .1, 'owner', async () => {}, jest.fn(), undefined, failure)
      .then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
    const event = (message: object) => DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'message', data: JSON.stringify(message) })
    await flush()
    DeviceEventEmitter.emit('VINoteASRTransport', { id, type: 'open' }); await flush()
    event({ type: 'session.started' }); await flush()
    expect(budgetArms()).toBe(1)
    await jest.advanceTimersByTimeAsync(60000)
    if (outcome === 'unconfirmed-LAST') {
      event({ type: 'asr.final', text: 'unconfirmed' }); await flush()
      expect(settled).toBe(false)
      expect(budgetArms()).toBe(1)
      await jest.advanceTimersByTimeAsync(budget - 60000)
      expect(failure).toHaveBeenCalledTimes(1)
      acknowledgeLast({ accepted: true, queueBytes: 0 }); await flush()
      expect(budgetArms()).toBe(1) // A late ACK cannot re-arm an expired session.
    } else {
      acknowledgeLast({ accepted: true, queueBytes: 0 }); await flush()
      expect(budgetArms()).toBe(2)
      // Cross the original whole-session deadline while retaining finalization time.
      await jest.advanceTimersByTimeAsync(40000)
      expect(settled).toBe(false)
      event({ type: 'session.started' })
      event({ type: 'asr.partial', audioMs: 100 }); await flush()
      expect(budgetArms()).toBe(2)
      if (outcome === 'late-final') {
        event({ type: 'asr.final', text: 'confirmed after original deadline' })
        expect(await result).toEqual({ value: 'confirmed after original deadline' })
        expect(failure).not.toHaveBeenCalled()
      } else {
        await jest.advanceTimersByTimeAsync(budget - 40000 - 1)
        event({ type: 'asr.partial', audioMs: 100 }); await flush()
        expect(settled).toBe(false)
        expect(budgetArms()).toBe(2)
        await jest.advanceTimersByTimeAsync(1)
      }
    }
    if (outcome !== 'late-final') {
      const observed = await result
      expect(observed).toHaveProperty('error')
      if ('error' in observed) expect(readASRDiagnostic(observed.error)).toMatchObject({ origin: 'deadline', sentComplete: outcome === 'no-progress' ? 1 : 0 })
      expect(failure).toHaveBeenCalledTimes(1)
    }
    expect(native.connect).toHaveBeenCalledTimes(1)
    expect(native.enqueue).toHaveBeenCalledTimes(2) // Start and LAST only; no replay.
    expect(native.close).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    timers.mockRestore()
    delete NativeModules.VINoteASRTransport
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS })
  }
})

test('full 22m57s transport sends exact PCM coverage on one frozen-model socket and waits for final', async () => {
  const totalBytes = 44_049_554, duration = totalBytes / 32000
  const frozenModel = 'asr:6:aliyun:22:paraformer-realtime-v2'
  let sockets = 0, frames = 0, bytes = 0, lasts = 0, starts = 0, reads = 0, settled = false
  // A plain function avoids Jest retaining every resolved base64 read result.
  FS.read = (async (_path: string, count: number) => {
    reads++
    return 'AAAA'.repeat(Math.floor(count / 3)) + (count % 3 === 1 ? 'AA==' : count % 3 === 2 ? 'AAA=' : '')
  }) as typeof FS.read
  class CountingSocket extends Socket {
    constructor() { super(); sockets++ }
    send(value: unknown) {
      if (typeof value === 'string') {
        const start = JSON.parse(value)
        expect(start).toMatchObject({ type: 'session.start', model: frozenModel })
        starts++; return
      }
      const frame = new DataView(value as ArrayBuffer)
      const length = frame.getUint32(16, true), flags = frame.getUint8(6)
      expect(frame.getUint32(8, true)).toBe(frames)
      expect(frame.byteLength).toBe(20 + length)
      expect(length).toBe(Math.min(6400, totalBytes - bytes))
      expect(Boolean(flags & 1)).toBe(frames === 0)
      bytes += length; frames++
      expect(Boolean(flags & 2)).toBe(bytes === totalBytes)
      if (flags & 2) lasts++
      // Deliberately retain no PCM/base64 payload or frame array.
    }
  }
  globalThis.WebSocket = CountingSocket as never
  const result = recognizeInterval('file:///synthetic.wav', frozenModel, 0, duration, 'owner', async () => {}, jest.fn())
    .then(text => { settled = true; return text })
  await flush(); const socket = Socket.current
  socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
  const lastFrameDeadline = (Math.ceil(totalBytes / 6400) - 1) * 200
  await jest.advanceTimersByTimeAsync(lastFrameDeadline - 1)
  expect(bytes).toBe(44_044_800)
  expect(frames).toBe(6882); expect(lasts).toBe(0); expect(settled).toBe(false)
  await jest.advanceTimersByTimeAsync(1); await flush()
  expect(bytes).toBe(totalBytes)
  expect(frames).toBe(6883); expect(lasts).toBe(1)
  expect(sockets).toBe(1); expect(starts).toBe(1)
  expect(settled).toBe(false) // Complete sending is not a final result.
  socket.event({ type: 'asr.partial', audioMs: duration * 1000 }); await flush()
  expect(settled).toBe(false)
  socket.event({ type: 'asr.final', text: 'synthetic final' })
  await expect(result).resolves.toBe('synthetic final')
  expect(reads).toBe(6883)
  expect(socket.sent).toHaveLength(0)
}, 19000)

// The notification is independent of settlement, which still protects the lock.
test.each(['resolve', 'reject'] as const)('cleanup barrier reproduction: known error stays pending until close %s, without resend', async outcome => {
  let finishClose!: () => void, failClose!: (error: Error) => void
  let finishRead!: (value: string) => void
  const close = jest.fn(() => new Promise<void>((resolve, reject) => { finishClose = resolve; failClose = reject }))
  const read = jest.fn(() => new Promise<string>(resolve => { finishRead = resolve }))
  NativeModules.MeetingAudio = { openPcmReader: jest.fn(async () => 'test-handle'), readPcmReader: read, closePcmReader: close }
  const onFailure = jest.fn(() => { throw new Error('synthetic observer failure') })
  const operation = jest.fn(() => recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn(), undefined, onFailure))
  const downstream = jest.fn()
  let observedError: unknown
  const result = retry(operation, async () => {}, jest.fn()).then(downstream, error => { observedError = error })
  await flush()
  const socket = Socket.current, closeSocket = jest.spyOn(socket, 'close')
  socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
  expect(read).toHaveBeenCalledTimes(1)
  socket.event({ type: 'session.error', code: 'asr_stream_failed', stage: 'asr' })
  await flush()
  expect(closeSocket).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(onFailure).toHaveBeenCalledTimes(1)
  expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'asr_stream_failed' }))
  // The observer has run, but cleanup still protects the caller's lock.
  expect(observedError).toBeUndefined()
  finishRead('AAAA'.repeat(2133) + 'AA==')
  socket.onopen?.(); socket.event({ type: 'session.started' })
  await jest.advanceTimersByTimeAsync(10000)
  expect(socket.sent).toHaveLength(1) // session.start only; no late PCM or new start.
  expect(operation).toHaveBeenCalledTimes(1)
  expect(downstream).not.toHaveBeenCalled()
  expect(observedError).toBeUndefined()
  if (outcome === 'resolve') finishClose(); else failClose(new Error('synthetic cleanup failure'))
  await result; await flush()
  expect(observedError).toBeInstanceOf(ASRServiceFailure)
  expect(observedError).toMatchObject({ code: 'asr_stream_failed' })
  expect(operation).toHaveBeenCalledTimes(1)
  expect(downstream).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
  expect(onFailure).toHaveBeenCalledTimes(1)
})

test.each(['limit', 'cancel', 'identity', 'revoked'] as const)('failure observer skips %s while cleanup retains the barrier', async reason => {
  let finishClose!: () => void
  NativeModules.MeetingAudio = {
    openPcmReader: jest.fn(async () => 'test-handle'),
    readPcmReader: jest.fn(async () => 'AAAA'.repeat(2133) + 'AA=='),
    closePcmReader: jest.fn(() => new Promise<void>(resolve => { finishClose = resolve })),
  }
  const onFailure = jest.fn(), controller = new AbortController()
  let settled = false
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn(), controller.signal, onFailure)
    .then(() => { settled = true }, () => { settled = true })
  await flush(); const socket = Socket.current
  socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
  const sends = socket.sent.length
  if (reason === 'limit') socket.event({ type: 'session.error', code: 'audio_duration_exceeded', maxAudioDurationSeconds: .5 })
  if (reason === 'cancel') controller.abort()
  if (reason === 'identity') transitionIdentity('other')
  if (reason === 'revoked') pauseRemote('expired')
  await flush()
  expect(NativeModules.MeetingAudio.closePcmReader).toHaveBeenCalledTimes(1)
  expect(onFailure).not.toHaveBeenCalled()
  expect(settled).toBe(false)
  await jest.advanceTimersByTimeAsync(1000)
  expect(socket.sent).toHaveLength(sends)
  finishClose(); await result
  expect(settled).toBe(true)
})

test('cleanup barrier reproduction: successful final cannot resolve before close confirmation', async () => {
  let finishClose!: () => void
  NativeModules.MeetingAudio = {
    openPcmReader: jest.fn(async () => 'test-handle'),
    readPcmReader: jest.fn(async () => 'AAAA'.repeat(1066) + 'AAA='),
    closePcmReader: jest.fn(() => new Promise<void>(resolve => { finishClose = resolve })),
  }
  const accepted = jest.fn()
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn()).then(accepted)
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  Socket.current.event({ type: 'asr.final', text: 'complete' }); await flush()
  expect(NativeModules.MeetingAudio.closePcmReader).toHaveBeenCalledTimes(1)
  expect(accepted).not.toHaveBeenCalled()
  finishClose(); await result
  expect(accepted).toHaveBeenCalledWith('complete')
})

test('actual sender includes 40ms reader cost in the sample deadline and retains last/final coverage', async () => {
  const normalRead = (FS.read as jest.Mock).getMockImplementation()!
  FS.read = jest.fn(async (...args) => {
    await new Promise<void>(resolve => setTimeout(resolve, 40))
    return normalRead(...args)
  })
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .6, 'owner', async () => {}, jest.fn())
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  await jest.advanceTimersByTimeAsync(439)
  expect(Socket.current.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(2)
  await jest.advanceTimersByTimeAsync(1)
  const frames = Socket.current.sent.filter((value): value is ArrayBuffer => value instanceof ArrayBuffer)
  expect(frames).toHaveLength(3)
  expect(frames.map(value => new DataView(value).getUint32(8, true))).toEqual([0, 1, 2])
  expect(new DataView(frames[2]).getUint8(6) & 2).toBe(2)
  Socket.current.event({ type: 'asr.final', text: 'complete' })
  await expect(result).resolves.toBe('complete')
})

test('a delayed file read does not trigger catch-up audio packets', async () => {
  let release!: () => void
  const read = FS.read as jest.Mock
  const normalRead = read.getMockImplementation()!
  read.mockImplementationOnce(normalRead).mockImplementationOnce(async (...args) => {
    await new Promise<void>(resolve => { release = resolve })
    return normalRead(...args)
  })
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .6, 'owner', async () => {}, jest.fn())
  await flush()
  Socket.current.event({ type: 'session.started' })
  await flush()
  await jest.advanceTimersByTimeAsync(200)
  jest.setSystemTime(Date.now() + 5000)
  release()
  await flush()
  expect(Socket.current.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(2)
  await jest.advanceTimersByTimeAsync(199)
  expect(Socket.current.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(2)
  await jest.advanceTimersByTimeAsync(1)
  await flush()
  expect(Socket.current.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(3)
  Socket.current.event({ type: 'asr.final', text: 'complete' })
  await expect(result).resolves.toBe('complete')
})

test('binary LAST framing carries exact PCM length and sequence', () => {
  const frame = new DataView(pcmFrame('AQID', 9, true, true))
  expect(frame.getUint8(6)).toBe(3)
  expect(frame.getUint32(8, true)).toBe(9)
  expect(frame.getUint32(16, true)).toBe(3)
  expect([...new Uint8Array(frame.buffer).slice(20)]).toEqual([1, 2, 3])
  expect(durationLimit({ code: 'network_error', maxAudioDurationSeconds: 50 })).toBeUndefined()
})

test('partial followed by close never resolves as successful recognition', async () => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toThrow('连接关闭')
  await flush()
  Socket.current.event({ type: 'asr.partial', text: 'temporary', audioMs: 900 })
  Socket.current.close()
  await failure
})

test('final guard can finish after normal server close without losing the result', async () => {
  let allowFinal!: () => void
  let guarded = 0
  const guard = async () => {
    guarded++
    if (guarded === 3) await new Promise<void>(resolve => { allowFinal = resolve })
  }
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', guard, jest.fn())
  await flush()
  Socket.current.onopen?.()
  Socket.current.event({ type: 'session.started' })
  await flush()
  Socket.current.event({ type: 'asr.final', text: ' final ' })
  await flush()
  Socket.current.close()
  allowFinal()
  await expect(result).resolves.toBe('final')
})

test('premature final does not accept an unsent recording', async () => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toThrow('尚未发送完整')
  await flush()
  Socket.current.event({ type: 'asr.final', text: 'premature' })
  await failure
})

test('account changes during audio read cannot send the late frame', async () => {
  let changed = false
  FS.read = jest.fn(async (_path, bytes = 0) => {
    changed = true
    transitionIdentity('other')
    return 'AAAA'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : '')
  })
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', async () => {
    if (changed) throw new Error('账号已切换')
  }, jest.fn())
  const failure = expect(result).rejects.toThrow('账号或服务已切换')
  await flush()
  Socket.current.onopen?.()
  Socket.current.event({ type: 'session.started' })
  await failure
  expect(Socket.current.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
})

test('normal background and renewal keep sending; final waits for verified', async () => {
  const guard = jest.fn(async () => {})
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .6, 'owner', guard, jest.fn())
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  pauseRemote(); await jest.advanceTimersByTimeAsync(200)
  const ticket = beginVerification('owner'); await jest.advanceTimersByTimeAsync(200)
  expect(Socket.current.sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(3)
  Socket.current.event({ type: 'asr.final', text: 'complete' }); Socket.current.close(); await flush()
  expect(guard).toHaveBeenCalledTimes(2)
  finishVerification(ticket, 'verified')
  await expect(result).resolves.toBe('complete')
  expect(guard).toHaveBeenCalledTimes(3)
})
test.each(['expired', 'signed-out', 'offline-known'] as const)('running socket closes immediately on %s', async mode => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toThrow()
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  const socket = Socket.current, close = jest.spyOn(socket, 'close')
  pauseRemote(mode); expect(close).toHaveBeenCalledTimes(1); await failure
  await jest.advanceTimersByTimeAsync(500)
  expect(socket.sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(1)
})
test('A-B-A closes immediately and cannot revive an old socket', async () => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toThrow()
  await flush()
  const socket = Socket.current, close = jest.spyOn(socket, 'close')
  transitionIdentity('other'); transitionIdentity('owner'); finishVerification(beginVerification('owner'), 'verified')
  expect(close).toHaveBeenCalledTimes(1)
  socket.onopen?.(); socket.event({ type: 'session.started' }); await failure
  expect(socket.sent).toHaveLength(0)
})
test('final while checking expires after ten seconds', async () => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn())
  const failure = expect(result).rejects.toMatchObject({ code: 'SESSION_NOT_VERIFIED' })
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  pauseRemote(); Socket.current.event({ type: 'asr.final', text: 'blocked' })
  await jest.advanceTimersByTimeAsync(10000); await failure
})
test('expiry during the final durable guard discards the result', async () => {
  let release!: () => void, calls = 0
  const guard = async () => { if (++calls === 3) await new Promise<void>(resolve => { release = resolve }) }
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', guard, jest.fn())
  const failure = expect(result).rejects.toThrow()
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  Socket.current.event({ type: 'asr.final', text: 'blocked' }); await flush()
  pauseRemote('expired'); release(); await failure
})
test('checking before new socket blocks start', async () => {
  pauseRemote(); const create = jest.fn(); globalThis.WebSocket = create as never
  await expect(recognizeInterval('file:///a.wav', 'chosen', 0, 1, 'owner', async () => {}, jest.fn())).rejects.toThrow()
  expect(create).not.toHaveBeenCalled()
})


test('socket structured empty error remains typed and drops provider text/session/credentials', async () => {
  const result = recognizeInterval('file:///a.wav', 'chosen', 0, .1, 'owner', async () => {}, jest.fn())
  const caught = result.catch(error => error)
  await flush(); Socket.current.onopen?.(); Socket.current.event({ type: 'session.started' }); await flush()
  Socket.current.event({ type: 'session.error', code: 'empty_result_unverified', stage: 'asr', message: 'SYNTHETIC_SECRET_BODY', sessionId: 'SYNTHETIC_SECRET_BODY', token: 'SYNTHETIC_SECRET_BODY' })
  const error = await caught
  expect(error).toBeInstanceOf(ASRServiceFailure)
  expect(error.code).toBe('empty_result_unverified')
  expect(error.diagnostic).toEqual({ category: 2, stage: 2, audioAttempted: 1, sentComplete: 1 })
  expect(JSON.stringify(error)).not.toContain('SYNTHETIC_SECRET_BODY')
})


test('equal ASR model IDs use only the configured LAN or public socket origin', async () => {
  const env = require('../src/config/env') as { API_BASE_URL: string }
  const original = env.API_BASE_URL
  try {
    for (const origin of ['http://192.168.1.143:9876', 'https://api.orulink.ai']) {
      env.API_BASE_URL = origin
      const result = recognizeInterval('file:///synthetic.wav', 'same-asr-id', 0, .1, 'owner', async () => {}, jest.fn())
      await flush()
      const socket = Socket.current
      expect(socket.url).toBe(origin.replace(/^http/, 'ws') + '/v1/asr/transcriptions')
      socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
      await jest.advanceTimersByTimeAsync(200); await flush()
      socket.event({ type: 'asr.final', text: '已确认正文' })
      await expect(result).resolves.toBe('已确认正文')
      expect(socket.sent.some(value => typeof value === 'string' && value.includes('same-asr-id'))).toBe(true)
    }
  } finally { env.API_BASE_URL = original }
})
