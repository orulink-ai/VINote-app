jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(async () => [{ id: 'unused' }]) }))
import { loadModels } from '../src/lib/models'
import FS from 'react-native-fs'
import { NativeModules } from 'react-native'
import { transcribe } from '../src/lib/meetingCloud'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(async () => ({ expires_at: 9999999999 })) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'synthetic') }))
class Socket {
  static all: Socket[] = []
  sent: unknown[] = []
  onopen?: () => void; onclose?: () => void; onerror?: () => void
  onmessage?: (event: { data: string }) => void
  constructor() { Socket.all.push(this) }
  send(data: unknown) { this.sent.push(data) }
  close() { this.onclose?.() }
  event(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const control = () => ({ owner: 'A', guard: jest.fn(async () => {}), save: jest.fn(async () => {}), progress: jest.fn() })
beforeEach(() => {
  jest.mocked(loadModels).mockImplementation(async () => ['chosen-model', 'chosen', 'frozen-model', 'original-selected-model', 'asr:aliyun:example', 'asr:volcengine-asr:example', 'asr:future-provider:any-model'].map(id => ({ id, modelType: 'asr', runtimeStatus: 'available', capabilities: { recordedAudio: { protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: 67108864, policySource: 'service_budget' } } })))
  transitionIdentity('A'); finishVerification(beginVerification('A'), 'verified'); jest.useFakeTimers()
  Socket.all = []; globalThis.WebSocket = Socket as never
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-synthetic.wav'), wavInfo: jest.fn(async () => .1) }
  FS.stat = jest.fn(async () => ({ size: 3200, mtime: new Date(1000) } as never))
  FS.read = jest.fn(async (_p, bytes = 0) => 'AAAA'.repeat(Math.floor(bytes / 3)) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : ''))
})
afterEach(() => jest.useRealTimers())

test.each(['server_error', 'socket_error'] as const)('%s reports failed progress before cleanup without settling or replaying', async origin => {
  let finishClose!: () => void
  Object.assign(NativeModules.MeetingAudio, {
    openPcmReader: jest.fn(async () => 'synthetic-handle'),
    readPcmReader: jest.fn(async () => 'AAAA'.repeat(1066) + 'AAA='),
    closePcmReader: jest.fn(() => new Promise<void>(resolve => { finishClose = resolve })),
  })
  const options = control()
  let settled = false
  const result = transcribe('file:///original.wav', 'frozen-model', options).catch(error => { settled = true; return error })
  await flush(); const socket = Socket.all[0]
  socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
  if (origin === 'server_error') socket.event({ type: 'session.error', code: 'asr_stream_failed', stage: 'asr' })
  else socket.onerror?.()
  await flush()
  expect(options.progress).toHaveBeenLastCalledWith('失败，原录音和已完成识别保留；正在释放转写资源')
  expect(settled).toBe(false)
  await jest.advanceTimersByTimeAsync(10000)
  expect(Socket.all).toHaveLength(1)
  expect(options.save).toHaveBeenCalledTimes(2)
  finishClose()
  expect(await result).toMatchObject({ code: origin === 'server_error' ? 'asr_stream_failed' : 'unknown_result' })
  expect(Socket.all).toHaveLength(1)
  expect(options.save).toHaveBeenCalledTimes(2)
})

test('even pre-audio transport failure does not automatically replay a planned invocation', async () => {
  const options = control(), result = transcribe('file:///original.wav', 'original-selected-model', options)
  const failure = expect(result).rejects.toThrow()
  await flush(); Socket.all[0].onopen?.(); Socket.all[0].onerror?.()
  await failure; await jest.advanceTimersByTimeAsync(5000)
  expect(Socket.all).toHaveLength(1)
  expect(options.save).toHaveBeenLastCalledWith(expect.objectContaining({ inFlight: { start: 0, end: .1 }, intervals: [] }))
})

test.each(['error', 'close', 'timeout', 'unknown_result'])('after LAST and partial, %s is unknown and never retries or saves text', async reason => {
  const options = control(), result = transcribe('file:///original.wav', 'original-selected-model', options)
  const failure = expect(result).rejects.toMatchObject({ code: 'unknown_result' })
  await flush(); const socket = Socket.all[0]; socket.onopen?.(); socket.event({ type: 'session.started' }); await flush()
  socket.event({ type: 'asr.partial', audioMs: 100, text: 'temporary' })
  if (reason === 'error') socket.onerror?.()
  if (reason === 'close') socket.close()
  if (reason === 'timeout') await jest.advanceTimersByTimeAsync(90150)
  if (reason === 'unknown_result') socket.event({ type: 'session.error', code: 'unknown_result' })
  await failure; await jest.advanceTimersByTimeAsync(5000)
  expect(Socket.all).toHaveLength(1)
  expect(options.save).toHaveBeenCalledTimes(2)
  expect(options.save).toHaveBeenCalledWith(expect.objectContaining({ intervals: [] }))
})

test('explicit unknown_result before PCM is also nontransient', async () => {
  const result = transcribe('file:///original.wav', 'chosen', control())
  const failure = expect(result).rejects.toMatchObject({ code: 'unknown_result' })
  await flush(); Socket.all[0].event({ type: 'error', code: 'unknown_result' }); await failure
  await jest.advanceTimersByTimeAsync(5000); expect(Socket.all).toHaveLength(1)
})

test('expired then reverified during retry cannot resume the revoked invocation', async () => {
  const result = transcribe('file:///original.wav', 'chosen', control())
  const failure = expect(result).rejects.toThrow()
  await flush(); Socket.all[0].onerror?.(); await flush()
  pauseRemote('expired'); finishVerification(beginVerification('A'), 'verified')
  await jest.advanceTimersByTimeAsync(1000); await failure
  expect(Socket.all).toHaveLength(1)
})

test('partial audio before LAST is conservatively unknown on close and never replays', async () => {
  NativeModules.MeetingAudio.wavInfo.mockResolvedValue(.4)
  const options = control(), result = transcribe('file:///original.wav', 'chosen', options)
  const failure = expect(result).rejects.toMatchObject({ code: 'unknown_result' })
  await flush(); Socket.all[0].event({ type: 'session.started' }); await flush()
  expect(Socket.all[0].sent.filter(v => v instanceof ArrayBuffer)).toHaveLength(1)
  Socket.all[0].close(); await failure; await jest.advanceTimersByTimeAsync(5000)
  expect(Socket.all).toHaveLength(1); expect(options.save).toHaveBeenCalledTimes(2)
})

test('throwing bridge audio send has unknown outcome and cannot replay', async () => {
  const options = control(), result = transcribe('file:///original.wav', 'chosen', options)
  const failure = expect(result).rejects.toMatchObject({ code: 'unknown_result' })
  await flush()
  const socket = Socket.all[0], send = socket.send.bind(socket)
  socket.send = data => { if (data instanceof ArrayBuffer) throw new Error('bridge failed'); send(data) }
  socket.event({ type: 'session.started' }); await failure
  await jest.advanceTimersByTimeAsync(5000)
  expect(Socket.all).toHaveLength(1); expect(options.save).toHaveBeenCalledTimes(2)
})
