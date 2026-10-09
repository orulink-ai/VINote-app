import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { apiJson, ApiError } from '../src/lib/api'
import { TransportError } from '../src/lib/errors'
import { transcribe, summarize, splitTranscript, splitMeetingEvidence, TranscriptionCheckpoint } from '../src/lib/meetingCloud'
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn(), ApiError: jest.requireActual('../src/lib/errors').ApiError }))
beforeEach(() => {
  jest.clearAllMocks()
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-full.wav'), wavInfo: jest.fn(async () => 130), wavChunk: jest.fn(async (_uri, index) => `file:///cache/asr-${index}.wav`) }
  jest.mocked(FS.stat).mockResolvedValue({ size: 10000, mtime: new Date(1700000000000) } as never)
  FS.unlink = jest.fn(async () => {})
})
afterEach(() => { jest.useRealTimers() })

test('retries transient transport failure without repeating saved chunks', async () => {
  jest.useFakeTimers()
  jest.mocked(apiJson).mockReset()
  jest.mocked(apiJson).mockRejectedValueOnce(new TransportError('timeout')).mockResolvedValueOnce({ text: '最后一段' })
  const progress = jest.fn()
  const save = jest.fn(async () => {})
  const operation = transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 2, model: 'asr', duration: 130, parts: ['一', '二'] }, guard: async () => {}, progress, save })
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
  const operation = transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 2, model: 'asr', duration: 130, parts: ['一', '二'] }, guard: async () => {}, progress: jest.fn(), save })
  const assertion = expect(operation).rejects.toThrow('timeout')
  await jest.runAllTimersAsync()
  await assertion
  expect(apiJson).toHaveBeenCalledTimes(3)
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ parts: expect.arrayContaining([null]) }))
  jest.mocked(apiJson).mockReset()
})
test('resumes completed chunks, saves silent sections and removes only temporary WAVs', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce({ text: '' }).mockResolvedValueOnce({ text: '最后一段' })
  const checkpoints: TranscriptionCheckpoint[] = []
  const result = await transcribe('file:///original.m4a', 'asr', { checkpoint: { version: 2, model: 'asr', duration: 130, parts: ['第一段'] }, guard: async () => {}, progress: jest.fn(), save: async value => { checkpoints.push(value) } })
  expect(NativeModules.MeetingAudio.wavChunk.mock.calls.map((args: unknown[]) => args[1])).toEqual([1, 2])
  expect(checkpoints.at(-1)?.parts).toEqual(['第一段', '', '最后一段'])
  expect(result).toContain('最后一段')
  expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
})
test.each(['Aliyun ASR returned an empty transcript.', 'Volcengine ASR returned an empty transcript.'])(
  'continues after an explicitly empty ASR chunk: %s', async message => {
    jest.mocked(apiJson).mockReset().mockRejectedValueOnce(new ApiError(message, 502)).mockResolvedValueOnce({ text: '后续语音' })
    const save = jest.fn(async () => {})
    const result = await transcribe('file:///original.m4a', 'asr', {
      checkpoint: { version: 2, model: 'asr', duration: 130, parts: ['此前语音'] },
      guard: async () => {}, progress: jest.fn(), save,
    })
    expect(result).toContain('后续语音')
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ parts: ['此前语音', '', '后续语音'] }))
    expect(apiJson).toHaveBeenCalledTimes(2)
  },
)
test('does not treat other ASR gateway errors as silent audio', async () => {
  jest.useFakeTimers()
  jest.mocked(apiJson).mockReset().mockRejectedValue(new ApiError('Volcengine ASR disconnected before its final result', 502))
  const save = jest.fn(async () => {})
  const operation = transcribe('file:///original.m4a', 'asr', {
    checkpoint: { version: 2, model: 'asr', duration: 130, parts: ['此前语音', '其他语音'] },
    guard: async () => {}, progress: jest.fn(), save,
  })
  const assertion = expect(operation).rejects.toThrow('Volcengine ASR disconnected before its final result')
  await jest.runAllTimersAsync()
  await assertion
  expect(apiJson).toHaveBeenCalledTimes(3)
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ parts: expect.arrayContaining([null]) }))
})
test('reports no recognizable speech when every provider chunk is explicitly empty', async () => {
  jest.mocked(apiJson).mockReset().mockRejectedValue(new ApiError('Volcengine ASR returned an empty transcript.', 502))
  const save = jest.fn(async () => {})
  await expect(transcribe('file:///original.m4a', 'asr', {
    guard: async () => {}, progress: jest.fn(), save,
  })).rejects.toThrow('未识别到有效语音')
  expect(save).toHaveBeenCalledTimes(4)
  expect(apiJson).toHaveBeenCalledTimes(3)
})
test('retains completed chunks when a later request fails', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce({ text: '已完成' }).mockRejectedValueOnce(new Error('offline'))
  const save = jest.fn(async () => {})
  await expect(transcribe('file:///original.m4a', 'asr', { guard: async () => {}, progress: jest.fn(), save })).rejects.toThrow('offline')
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ parts: ['已完成', null, null] }))
})
test('splitting preserves every character and bounds each summary input', () => {
  const text = '会议讨论。'.repeat(5000)
  const parts = splitTranscript(text)
  expect(parts.join('')).toBe(text)
  expect(parts.every(part => part.length <= 10000)).toBe(true)
})
test('evidence chunks retain the recording offset for every section', () => {
  const source = Array.from({ length: 8 }, (_, index) => `[录音第 ${index * 2} 分钟起]\n${'这段讨论声学参数。'.repeat(60)}`).join('\n\n')
  const parts = splitMeetingEvidence(source, 1000)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(part => /^\[录音第 \d+ 分钟起\]/.test(part))).toBe(true)
  expect(parts.every(part => part.length <= 1000)).toBe(true)
  expect(parts.join('\n\n').replace(/\s/g, '')).toBe(source.replace(/\s/g, ''))
  const longSection = `[录音第 12 分钟起]\n${'远距离收音参数。'.repeat(500)}`
  const continuations = splitMeetingEvidence(longSection, 1000)
  expect(continuations.length).toBeGreaterThan(1)
  expect(continuations.every(part => part.startsWith('[录音第 12 分钟起]') && part.length <= 1000)).toBe(true)
})
test('a 28-minute meeting extracts timestamped facts before drafting and auditing', async () => {
  jest.mocked(apiJson).mockReset().mockImplementation(async (_path, init) => {
    const request = JSON.parse(init!.body as string)
    const system: string = request.messages[0].content
    if (system.includes('逐段提取')) return { choices: [{ message: { content: '- [录音第 20 分钟起] 收音距离约三倍\n- [录音第 26 分钟起] 会后确认工程师时间' } }] } as never
    if (system.includes('核查初稿')) return { choices: [{ message: { content: '# 语音键盘收音方案讨论\n\n收音距离约三倍。[录音第 20 分钟起]\n\n会后确认工程师时间。[录音第 26 分钟起]' } }] } as never
    return { choices: [{ message: { content: '# 初稿' } }] } as never
  })
  const transcript = Array.from({ length: 15 }, (_, i) => `[录音第 ${i * 2} 分钟起]\n${'会议讨论声学参数与后续测试。'.repeat(80)}`).join('\n\n')
  const save = jest.fn(async () => {})
  const result = await summarize(transcript, '语音键盘会议', 'llm', { guard: async () => {}, progress: jest.fn(), save })
  const requests = jest.mocked(apiJson).mock.calls.map(([, init]) => JSON.parse(init!.body as string))
  expect(requests.filter(request => request.messages[0].content.includes('逐段提取')).length).toBeGreaterThan(1)
  expect(requests.some(request => request.messages[0].content.includes('核查初稿'))).toBe(true)
  expect(requests.filter(request => request.messages[0].content.includes('逐段提取')).every(request => request.messages[0].content.includes('不限于决策'))).toBe(true)
  expect(requests.every(request => request.model === 'llm')).toBe(true)
  expect(result).toContain('收音距离约三倍')
  expect(save).toHaveBeenCalledTimes(requests.length)
})

test('short summary uses original evidence instead of an unnecessary cached fact sheet', async () => {
  jest.mocked(apiJson).mockReset().mockResolvedValue({ choices: [{ message: { content: '# 新纪要' } }] } as never)
  const source = `[录音第 0 分钟起]\n${'会议内容。'.repeat(300)}`
  const checkpoint = { version: 8 as const, model: 'llm', title: '会议', source, parts: { 'facts:0': '- [录音第 0 分钟起] 已提取事实' } }
  await summarize(source, '会议', 'llm', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  const requests = jest.mocked(apiJson).mock.calls.map(([, init]) => JSON.parse(init!.body as string))
  expect(requests.every(request => !request.messages[0].content.includes('逐段提取'))).toBe(true)
  expect(requests.length).toBe(2)
})
test('an older summary prompt checkpoint is regenerated', async () => {
  jest.mocked(apiJson).mockReset().mockResolvedValue({ choices: [{ message: { content: '# 新纪要' } }] } as never)
  const source = '[录音第 0 分钟起]\n讨论新的参数。'
  await summarize(source, '会议', 'llm', { checkpoint: { version: 3, model: 'llm', title: '会议', source, parts: { 'facts:0': '旧事实', draft: '旧初稿', audit: '旧纪要' } } as never,
    guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(apiJson).toHaveBeenCalledTimes(2)
})
