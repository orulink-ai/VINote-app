import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { apiJson } from '../src/lib/api'
import { TransportError } from '../src/lib/errors'
import { transcribe, summarize, splitTranscript, TranscriptionCheckpoint } from '../src/lib/meetingCloud'
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn(), ApiError: class extends Error {} }))
beforeEach(() => {
  jest.clearAllMocks()
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-full.wav'), wavInfo: jest.fn(async () => 250), wavChunk: jest.fn(async (_uri, index) => `file:///cache/asr-${index}.wav`) }
  FS.unlink = jest.fn(async () => {})
})
afterEach(() => { jest.useRealTimers() })

test('retries transient transport failure without repeating saved chunks', async () => {
  jest.useFakeTimers()
  jest.mocked(apiJson).mockReset()
  jest.mocked(apiJson).mockRejectedValueOnce(new TransportError('timeout')).mockResolvedValueOnce({ text: '最后一段' })
  const progress = jest.fn()
  const save = jest.fn(async () => {})
  const operation = transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 1, model: 'asr', duration: 250, parts: ['一', '二'] }, guard: async () => {}, progress, save })
  await jest.runAllTimersAsync()
  await expect(operation).resolves.toContain('最后一段')
  expect(apiJson).toHaveBeenCalledTimes(2)
  expect(NativeModules.MeetingAudio.wavChunk).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ parts: ['一', '二', '最后一段'] }))
  expect(progress).toHaveBeenCalledWith(expect.stringContaining('1/2'))
})

test('transport retries are bounded and preserve previous checkpoints', async () => {
  jest.useFakeTimers()
  jest.mocked(apiJson).mockReset()
  jest.mocked(apiJson).mockRejectedValue(new TransportError('timeout'))
  const save = jest.fn(async () => {})
  const operation = transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 1, model: 'asr', duration: 250, parts: ['一', '二'] }, guard: async () => {}, progress: jest.fn(), save })
  const assertion = expect(operation).rejects.toThrow('timeout')
  await jest.runAllTimersAsync()
  await assertion
  expect(apiJson).toHaveBeenCalledTimes(3)
  expect(save).not.toHaveBeenCalled()
  jest.mocked(apiJson).mockReset()
})
test('resumes completed chunks, saves silent sections and removes only temporary WAVs', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce({ text: '' }).mockResolvedValueOnce({ text: '最后一段' })
  const checkpoints: TranscriptionCheckpoint[] = []
  const result = await transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 1, model: 'asr', duration: 250, parts: ['第一段'] }, guard: async () => {}, progress: jest.fn(), save: async value => { checkpoints.push(value) } })
  expect(NativeModules.MeetingAudio.wavChunk.mock.calls.map((args: unknown[]) => args[1])).toEqual([1, 2])
  expect(checkpoints[1].parts).toEqual(['第一段', '', '最后一段'])
  expect(result).toContain('最后一段')
  expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
})
test('retains completed chunks when a later request fails', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce({ text: '已完成' }).mockRejectedValueOnce(new Error('offline'))
  const save = jest.fn(async () => {})
  await expect(transcribe('file:///original.m4a', 'asr', { guard: async () => {}, progress: jest.fn(), save })).rejects.toThrow('offline')
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ parts: ['已完成'] }))
})
test('splitting preserves every character and bounds each summary input', () => {
  const text = '会议讨论。'.repeat(5000)
  const parts = splitTranscript(text)
  expect(parts.join('')).toBe(text)
  expect(parts.every(part => part.length <= 10000)).toBe(true)
})
test('long summaries reduce before final generation and cache all stages', async () => {
  jest.mocked(apiJson).mockResolvedValue({ choices: [{ message: { content: '有依据的摘要' } }] })
  const save = jest.fn(async () => {})
  await summarize('会议'.repeat(11000), '例会', 'llm', { guard: async () => {}, progress: jest.fn(), save })
  expect(apiJson).toHaveBeenCalledTimes(4)
  expect(save).toHaveBeenCalledTimes(4)
  expect(JSON.parse(jest.mocked(apiJson).mock.calls[3][1]!.body as string).messages[1].content).not.toContain('会议'.repeat(100))
})
