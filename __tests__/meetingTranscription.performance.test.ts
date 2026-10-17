import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { recognizeInterval } from '../src/lib/asrStream'
import { transcribe, type TranscriptionCheckpoint } from '../src/lib/meetingCloud'
jest.mock('../src/lib/asrStream', () => ({ recognizeInterval: jest.fn(), ASRSessionLimit: class extends Error {} }))
const source = { size: 10000, modifiedMs: 1700000000000 }
const options = () => ({ owner: 'owner', guard: async () => {}, progress: jest.fn(), save: jest.fn(async (_cp: TranscriptionCheckpoint) => {}) })
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(recognizeInterval).mockReset().mockResolvedValue('新发言')
  jest.mocked(FS.stat).mockResolvedValue({ size: source.size, mtime: new Date(source.modifiedMs) } as never)
  FS.unlink = jest.fn(async () => {})
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/new.wav'), wavInfo: jest.fn(async () => 130) }
})
test('recovers historical middle interval without uploading it again', async () => {
  const checkpoint: TranscriptionCheckpoint = { version: 3, model: 'model', duration: 130, source, audioCache: 'file:///cache/saved.wav', parts: [null, '已保存中段', null] }
  const result = await transcribe('file:///original.m4a', 'model', { ...options(), checkpoint })
  expect(result).toContain('已保存中段')
  expect(NativeModules.MeetingAudio.toWav).not.toHaveBeenCalled()
  expect(jest.mocked(recognizeInterval).mock.calls.map(args => [args[2], args[3]])).toEqual([[0, 60], [120, 130]])
})
test('changing source fingerprint prevents reuse of another audio recording', async () => {
  const checkpoint: TranscriptionCheckpoint = { version: 3, model: 'model', duration: 130, source: { ...source, size: 1 }, parts: ['旧发言'] }
  const result = await transcribe('file:///original.m4a', 'model', { ...options(), checkpoint })
  expect(result).not.toContain('旧发言')
  expect(recognizeInterval).toHaveBeenCalledTimes(1)
  expect(NativeModules.MeetingAudio.toWav).toHaveBeenCalledTimes(1)
})
test('rebuilds evicted audio while preserving completed recognition', async () => {
  NativeModules.MeetingAudio.wavInfo.mockRejectedValueOnce(new Error('evicted'))
  const checkpoint: TranscriptionCheckpoint = { version: 5, model: 'model', duration: 130, source, audioCache: 'file:///cache/saved.wav', intervals: [{ start: 0, end: 91, text: '保留发言' }] }
  const result = await transcribe('file:///original.m4a', 'model', { ...options(), checkpoint })
  expect(result).toContain('保留发言')
  expect(jest.mocked(recognizeInterval).mock.calls.map(args => [args[2], args[3]])).toEqual([[91, 130]])
})
test('save failure never reports 100 percent or removes recoverable audio', async () => {
  const settings = options()
  settings.save.mockRejectedValueOnce(new Error('disk full'))
  await expect(transcribe('file:///original.m4a', 'model', settings)).rejects.toThrow('disk full')
  expect(recognizeInterval).not.toHaveBeenCalled()
  expect(settings.progress).not.toHaveBeenCalledWith(expect.stringContaining('100%'))
  expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
})
