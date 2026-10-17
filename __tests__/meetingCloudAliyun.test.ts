jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(async () => [{ id: 'unused' }]) }))
import { loadModels } from '../src/lib/models'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { ASRSessionLimit, recognizeInterval } from '../src/lib/asrStream'
import { transcribe, type TranscriptionCheckpoint } from '../src/lib/meetingCloud'
import type { AsrProgress } from '../src/lib/asrProgress'
jest.mock('../src/lib/asrStream', () => ({ recognizeInterval: jest.fn(), ASRSessionLimit: class extends Error { seconds: number; constructor(value: number) { super('session limit'); this.seconds = value } } }))
const source = { size: 10000, modifiedMs: 1700000000000 }
const control = () => ({ owner: 'owner-a', guard: jest.fn(async () => {}), progress: jest.fn(), save: jest.fn(async (_cp: TranscriptionCheckpoint) => {}) })
beforeEach(() => {
  jest.mocked(loadModels).mockImplementation(async () => ['chosen-model', 'chosen', 'frozen-model', 'original-selected-model', 'asr:aliyun:example', 'asr:volcengine-asr:example', 'asr:future-provider:any-model'].map(id => ({ id, modelType: 'asr', runtimeStatus: 'available', capabilities: { recordedAudio: { protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: 67108864, policySource: 'service_budget' } } })))
  transitionIdentity('owner-a')
  finishVerification(beginVerification('owner-a'), 'verified')
  jest.clearAllMocks()
  jest.mocked(recognizeInterval).mockReset().mockResolvedValue('真实发言')
  jest.mocked(FS.stat).mockResolvedValue({ size: source.size, mtime: new Date(source.modifiedMs) } as never)
  FS.unlink = jest.fn(async () => {})
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/normalized.wav'), wavInfo: jest.fn(async () => 137) }
})
afterEach(() => jest.useRealTimers())

test('explicit recovery of complete 22m57s v5 coverage never calls recognizeInterval', async () => {
  const duration = 1376.5485625, model = 'asr:6:aliyun:22:paraformer-realtime-v2'
  NativeModules.MeetingAudio.wavInfo.mockResolvedValue(duration)
  const checkpoint: TranscriptionCheckpoint = { version: 5, model, duration, source,
    intervals: [{ start: 0, end: duration, text: 'synthetic retained transcript' }] }
  const options = { ...control(), checkpoint }
  await expect(transcribe('file:///original.m4a', model, options)).resolves.toContain('synthetic retained transcript')
  expect(recognizeInterval).not.toHaveBeenCalled()
  expect(options.save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5, model, duration, source, intervals: checkpoint.intervals }))
})

test('partial audio position never commits final coverage; final waits for durable save', async () => {
  const measured: AsrProgress[] = []
  const options = { ...control(), asrProgress: (value: AsrProgress) => measured.push({ ...value }) }
  let final!: (text: string) => void, saveDone!: () => void
  options.save.mockImplementation(async checkpoint => {
    if (checkpoint.version === 5 && checkpoint.intervals.length) await new Promise<void>(resolve => { saveDone = resolve })
  })
  jest.mocked(recognizeInterval).mockImplementationOnce(async (...args) => {
    args[6]!(137)
    return new Promise<string>(resolve => { final = resolve })
  })
  const operation = transcribe('file:///original.m4a', 'chosen-model', options)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(measured.at(-1)).toEqual({ duration: 137, submittedSeconds: 137, confirmedSeconds: 0 })
  expect(options.save.mock.calls.at(-1)![0]).toMatchObject({ intervals: [] })
  final('确认正文'); await new Promise<void>(resolve => setImmediate(resolve))
  expect(measured.at(-1)?.confirmedSeconds).toBe(0)
  options.save.mockImplementation(async () => {})
  saveDone(); await operation
  expect(measured.at(-1)?.confirmedSeconds).toBe(137)
  expect(options.progress).not.toHaveBeenCalledWith(expect.stringContaining('识别服务已处理'))
})

test('a rejected final save does not advance durable coverage', async () => {
  const values: AsrProgress[] = [], options = { ...control(), asrProgress: (value: AsrProgress) => values.push(value) }
  options.save.mockImplementation(async checkpoint => { if (checkpoint.version === 5 && checkpoint.intervals.length) throw new Error('disk failed') })
  jest.mocked(recognizeInterval).mockImplementationOnce(async (...args) => { args[6]!(137); return '正文' })
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow('disk failed')
  expect(values.every(value => value.confirmedSeconds === 0)).toBe(true)
  expect(options.progress).not.toHaveBeenCalledWith(expect.stringContaining('转写已保存'))
})

test('cached final coverage stays separate from current submitted position and empty final intervals', async () => {
  const values: AsrProgress[] = [], options = { ...control(), asrProgress: (value: AsrProgress) => values.push(value),
    checkpoint: { version: 5 as const, model: 'chosen-model', duration: 137, source, intervals: [{ start: 0, end: 50, text: '之前正文' }] } }
  jest.mocked(recognizeInterval).mockImplementationOnce(async (...args) => { args[6]!(20); return '' })
  await transcribe('file:///original.m4a', 'chosen-model', options)
  expect(values).toContainEqual({ duration: 137, submittedSeconds: 70, confirmedSeconds: 50 })
  expect(values.at(-1)).toEqual({ duration: 137, submittedSeconds: 137, confirmedSeconds: 137 })
  expect(options.save.mock.calls.at(-1)![0]).toMatchObject({ intervals: [{ start: 0, end: 50, text: '之前正文' }, { start: 50, end: 137, text: '' }] })
})

test.each(['asr:aliyun:example', 'asr:volcengine-asr:example', 'asr:future-provider:any-model'])(
  'uses the same framed transport for configured model %s without a name-based cap', async model => {
    const options = control()
    await transcribe('file:///original.m4a', model, options)
    expect(recognizeInterval).toHaveBeenCalledTimes(1)
    expect(recognizeInterval).toHaveBeenCalledWith('file:///cache/normalized.wav', model, 0, 137, 'owner-a', expect.any(Function), expect.any(Function), undefined, expect.any(Function))
    expect(options.progress).toHaveBeenCalledWith('转写已保存 · 100% · 137/137 秒')
    expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
  })
test('service-declared duration limit cannot automatically replay a planned invocation', async () => {
  jest.mocked(recognizeInterval).mockRejectedValueOnce(new ASRSessionLimit(53))
  const options = control()
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow()
  expect(recognizeInterval).toHaveBeenCalledTimes(1)
  expect(options.save).toHaveBeenLastCalledWith(expect.objectContaining({ inFlight: { start: 0, end: 137 }, intervals: [] }))
})

test('does not treat unknown provider failure as silence, success or a new duration limit', async () => {
  jest.mocked(recognizeInterval).mockRejectedValue(new Error('provider failed'))
  const options = control()
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow('provider failed')
  expect(recognizeInterval).toHaveBeenCalledTimes(1)
  expect(options.save).toHaveBeenLastCalledWith(expect.objectContaining({ intervals: [] }))
  expect(options.progress).not.toHaveBeenCalledWith(expect.stringContaining('100%'))
})
test('unconfirmed attempt is not overwritten or replayed on explicit recovery', async () => {
  const checkpoint: TranscriptionCheckpoint = { version: 5, model: 'chosen-model', duration: 137, source,
    intervals: [{ start: 0, end: 53, text: '已完成' }], inFlight: { start: 53, end: 106 } }
  const options = { ...control(), checkpoint }
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow('尚未确认')
  expect(recognizeInterval).not.toHaveBeenCalled(); expect(options.save).not.toHaveBeenCalled()
})

test.each(['expired', 'offline-known', 'checking'] as const)('cannot commit an interval after authorization becomes %s', async mode => {
  const options = control()
  jest.mocked(recognizeInterval).mockImplementationOnce(async () => { pauseRemote(mode); return 'must not save' })
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow()
  expect(options.save).toHaveBeenCalledTimes(2)
  expect(options.save.mock.calls[0][0]).toMatchObject({ intervals: [] })
})
test('normal reverify keeps original invocation authorized to save', async () => {
  const options = control()
  jest.mocked(recognizeInterval).mockImplementationOnce(async () => {
    pauseRemote(); finishVerification(beginVerification('owner-a'), 'verified'); return 'confirmed'
  })
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).resolves.toContain('confirmed')
  expect(options.save).toHaveBeenLastCalledWith(expect.objectContaining({ intervals: [{ start: 0, end: 137, text: 'confirmed' }] }))
})
test('A-B-A cannot save under newly verified same owner', async () => {
  const options = control()
  jest.mocked(recognizeInterval).mockImplementationOnce(async () => {
    transitionIdentity('B'); transitionIdentity('owner-a'); finishVerification(beginVerification('owner-a'), 'verified'); return 'old result'
  })
  await expect(transcribe('file:///original.m4a', 'chosen-model', options)).rejects.toThrow()
  expect(options.save).toHaveBeenCalledTimes(2)
})
