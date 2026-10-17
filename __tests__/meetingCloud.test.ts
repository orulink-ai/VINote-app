import { chatCompletion } from '../src/lib/chatCompletion'
import { summarize, splitTranscript, splitMeetingEvidence } from '../src/lib/meetingCloud'
jest.mock('../src/lib/asrStream', () => ({ recognizeInterval: jest.fn(), ASRSessionLimit: class extends Error {} }))
jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn() }))
beforeEach(() => { jest.clearAllMocks() })
afterEach(() => { jest.useRealTimers() })

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
test('a 28-minute meeting sends all timestamped evidence directly to draft and audit', async () => {
  jest.mocked(chatCompletion).mockReset().mockImplementation(async (_model, messages) => {
    const request = { model: _model, messages }
    const system: string = request.messages[0].content
    if (system.includes('逐段提取')) return { choices: [{ message: { content: '- [录音第 20 分钟起] 收音距离约三倍\n- [录音第 26 分钟起] 会后确认工程师时间' } }] } as never
    if (system.includes('核查初稿')) return { choices: [{ message: { content: '# 语音键盘收音方案讨论\n\n收音距离约三倍。[录音第 20 分钟起]\n\n会后确认工程师时间。[录音第 26 分钟起]' } }] } as never
    return { choices: [{ message: { content: '# 初稿' } }] } as never
  })
  const transcript = Array.from({ length: 15 }, (_, i) => `[录音第 ${i * 2} 分钟起]\n${'会议讨论声学参数与后续测试。'.repeat(80)}`).join('\n\n')
  const save = jest.fn(async () => {})
  const result = await summarize(transcript, '语音键盘会议', 'llm', { guard: async () => {}, progress: jest.fn(), save })
  const requests = jest.mocked(chatCompletion).mock.calls.map(([model, messages]) => ({ model, messages }))
  expect(requests).toHaveLength(2)
  expect(requests.every(request => request.messages[1].content.includes(transcript))).toBe(true)
  expect(requests.filter(request => request.messages[0].content.includes('逐段提取'))).toHaveLength(0)
  expect(requests.some(request => request.messages[0].content.includes('核查初稿'))).toBe(true)
  expect(requests.filter(request => request.messages[0].content.includes('逐段提取')).every(request => request.messages[0].content.includes('不限于决策'))).toBe(true)
  expect(requests.every(request => request.model === 'llm')).toBe(true)
  expect(result).toContain('收音距离约三倍')
  expect(save).toHaveBeenCalledTimes(requests.length)
})

test('short summary uses original evidence instead of an unnecessary cached fact sheet', async () => {
  jest.mocked(chatCompletion).mockReset().mockResolvedValue({ choices: [{ message: { content: '# 新纪要' } }] } as never)
  const source = `[录音第 0 分钟起]\n${'会议内容。'.repeat(300)}`
  const checkpoint = { version: 8 as const, model: 'llm', title: '会议', source, parts: { 'facts:0': '- [录音第 0 分钟起] 已提取事实' } }
  await summarize(source, '会议', 'llm', { checkpoint, guard: async () => {}, progress: jest.fn(), save: async () => {} })
  const requests = jest.mocked(chatCompletion).mock.calls.map(([model, messages]) => ({ model, messages }))
  expect(requests.every(request => !request.messages[0].content.includes('逐段提取'))).toBe(true)
  expect(requests.length).toBe(2)
})
test('an older summary prompt checkpoint is regenerated', async () => {
  jest.mocked(chatCompletion).mockReset().mockResolvedValue({ choices: [{ message: { content: '# 新纪要' } }] } as never)
  const source = '[录音第 0 分钟起]\n讨论新的参数。'
  await summarize(source, '会议', 'llm', { checkpoint: { version: 3, model: 'llm', title: '会议', source, parts: { 'facts:0': '旧事实', draft: '旧初稿', audit: '旧纪要' } } as never,
    guard: async () => {}, progress: jest.fn(), save: async () => {} })
  expect(chatCompletion).toHaveBeenCalledTimes(2)
})
