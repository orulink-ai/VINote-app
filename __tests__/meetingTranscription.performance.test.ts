import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { apiJson } from '../src/lib/api'
import { transcribe, TranscriptionCheckpoint } from '../src/lib/meetingCloud'
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn(), ApiError: jest.requireActual('../src/lib/errors').ApiError }))
const source = { size: 10000, modifiedMs: 1700000000000 }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(apiJson).mockReset()
  jest.mocked(FS.stat).mockResolvedValue({ size: source.size, mtime: new Date(source.modifiedMs) } as never)
  NativeModules.MeetingAudio = {
    toWav: jest.fn(async () => 'file:///cache/asr-full.wav'),
    wavInfo: jest.fn(async () => 130),
    wavChunk: jest.fn(async (_uri, index) => `file:///cache/asr-${index}.wav`),
  }
})

test('a one-minute recording uploads its prepared WAV directly', async () => {
  NativeModules.MeetingAudio.wavInfo.mockResolvedValue(60)
  jest.mocked(apiJson).mockResolvedValue({ text: '完整一分钟' })
  const result = await transcribe('file:///original.m4a', 'asr', { guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(result).toContain('完整一分钟')
  expect(NativeModules.MeetingAudio.wavChunk).not.toHaveBeenCalled()
  expect(apiJson).toHaveBeenCalledTimes(1)
  expect(FS.unlink).toHaveBeenCalledTimes(1)
  expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
})

test('long recordings overlap two ASR calls and persist results in source positions', async () => {
  const release: Array<(value: unknown) => void> = []
  jest.mocked(apiJson).mockImplementation(() => new Promise(resolve => { release.push(resolve) }) as never)
  const checkpoints: TranscriptionCheckpoint[] = []
  const operation = transcribe('file:///original.m4a', 'asr', { guard: async () => {}, progress: jest.fn(), save: async cp => { checkpoints.push(cp) } })
  await flush()
  expect(release).toHaveLength(2)
  release[1]({ text: '第二段' })
  await flush()
  expect(checkpoints.at(-1)?.parts).toEqual([null, '第二段', null])
  expect(release).toHaveLength(3)
  release[2]({ text: '第三段' })
  release[0]({ text: '第一段' })
  const result = await operation
  expect(result.indexOf('第一段')).toBeLessThan(result.indexOf('第二段'))
  expect(result.indexOf('第二段')).toBeLessThan(result.indexOf('第三段'))
  expect(checkpoints.at(-1)?.parts).toEqual(['第一段', '第二段', '第三段'])
})

test('failure preserves an out-of-order success and prepared audio for retry', async () => {
  let finish: (value: unknown) => void = () => {}
  jest.mocked(apiJson).mockRejectedValueOnce(new Error('failed')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
  const checkpoints: TranscriptionCheckpoint[] = []
  const operation = transcribe('file:///original.m4a', 'asr', { guard: async () => {}, progress: jest.fn(), save: async cp => { checkpoints.push(cp) } })
  const assertion = expect(operation).rejects.toThrow('failed')
  await flush()
  expect(FS.unlink).not.toHaveBeenCalledWith('/cache/asr-full.wav')
  finish({ text: '第二段完成' })
  await assertion
  expect(apiJson).toHaveBeenCalledTimes(2)
  expect(checkpoints.at(-1)?.parts).toEqual([null, '第二段完成', null])
  expect(checkpoints.at(-1)).toMatchObject({ version: 3, source, audioCache: 'file:///cache/asr-full.wav' })
})

test('retry validates prepared cache and requests only missing positions', async () => {
  const checkpoint = { version: 3, model: 'asr', duration: 130, source, audioCache: 'file:///cache/asr-saved.wav', parts: [null, '第二段', null] } as TranscriptionCheckpoint
  jest.mocked(apiJson).mockResolvedValueOnce({ text: '第一段' }).mockResolvedValueOnce({ text: '第三段' })
  await transcribe('file:///original.m4a', 'asr', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(NativeModules.MeetingAudio.toWav).not.toHaveBeenCalled()
  expect(NativeModules.MeetingAudio.wavInfo).toHaveBeenCalledWith(checkpoint.audioCache)
  expect(NativeModules.MeetingAudio.wavChunk.mock.calls.map((args: unknown[]) => args[1])).toEqual([0, 2])
  expect(apiJson).toHaveBeenCalledTimes(2)
})

test('evicted cache is rebuilt without discarding completed ASR results', async () => {
  NativeModules.MeetingAudio.wavInfo.mockRejectedValueOnce(new Error('evicted'))
  const checkpoint = { version: 3, model: 'asr', duration: 130, source, audioCache: 'file:///cache/asr-saved.wav', parts: [null, '第二段', null] } as TranscriptionCheckpoint
  jest.mocked(apiJson).mockResolvedValue({ text: '其他语音' })
  await transcribe('file:///original.m4a', 'asr', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(NativeModules.MeetingAudio.toWav).toHaveBeenCalledTimes(1)
  expect(apiJson).toHaveBeenCalledTimes(2)
})

test('changed source invalidates every old segment even when duration is unchanged', async () => {
  const checkpoint = { version: 3, model: 'asr', duration: 130, source: { ...source, size: 9999 }, audioCache: 'file:///cache/asr-saved.wav', parts: ['旧段一', '旧段二', '旧段三'] } as TranscriptionCheckpoint
  jest.mocked(apiJson).mockResolvedValue({ text: '新段' })
  const text = await transcribe('file:///original.m4a', 'asr', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(text).not.toContain('旧段')
  expect(apiJson).toHaveBeenCalledTimes(3)
})

test('fully saved transcription returns after restart without preparing or uploading audio again', async () => {
  const checkpoint = { version: 3, model: 'asr', duration: 130, source, parts: ['第一段', '第二段', '第三段'] } as TranscriptionCheckpoint
  const text = await transcribe('file:///original.m4a', 'asr', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(text).toContain('第三段')
  expect(NativeModules.MeetingAudio.toWav).not.toHaveBeenCalled()
  expect(apiJson).not.toHaveBeenCalled()
})
