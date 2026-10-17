import { summarize as cloudSummarize } from '../src/lib/meetingCloud'
import { summarize, SummaryCheckpoint } from '../src/lib/meetingSummary'
import { chatCompletion } from '../src/lib/chatCompletion'
import { ApiError, TransportError } from '../src/lib/errors'
import { recognizeInterval } from '../src/lib/asrStream'
import * as speakers from '../src/lib/meetingSpeakers'

jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn() }))
jest.mock('../src/lib/asrStream', () => ({ recognizeInterval: jest.fn(() => { throw new Error('ASR forbidden') }) }))

const answer = (content: string) => ({ choices: [{ finish_reason: 'stop', message: { content } }] })
const options = () => ({ guard: jest.fn(async () => {}), progress: jest.fn(), save: jest.fn(async (_checkpoint: SummaryCheckpoint) => {}) })
beforeEach(() => jest.mocked(chatCompletion).mockReset())
afterEach(() => jest.restoreAllMocks())

test.each(['deepseek-v4.1-flash', 'opaque-other-model'])('full long source and speaker evidence go to draft and overall audit with %s', async model => {
  const record = { transcript: Array.from({ length: 22 }, (_, i) => `[录音区间 ${i * 60}.000–${(i + 1) * 60}.000 秒]\nSOURCE_${i} ${'观点、理由、数字与条件。'.repeat(90)}`).join('\n\n'),
    asrModel: 'frozen-asr',
    speakerCheckpoint: { version: 1 as const, provider: 'sherpa-onnx-1.12.35' as const,
      duration: 1320, source: { size: 123, modifiedMs: 456 },
      turns: Array.from({ length: 22 }, (_, i) => ({ start: i * 60, end: (i + 1) * 60, speakerId: `speaker_${i}` })) } }
  const before = JSON.stringify(record)
  const evidence = speakers.meetingEvidence(record.transcript, record.speakerCheckpoint)
  const analyze = jest.spyOn(speakers, 'analyzeSpeakers').mockRejectedValue(new Error('speaker inference forbidden'))
  jest.mocked(chatCompletion).mockResolvedValueOnce(answer('# complete draft') as never).mockResolvedValueOnce(answer('# reviewed full note') as never)
  const state = options()
  expect(cloudSummarize).toBe(summarize)
  expect(await cloudSummarize(evidence, '会议', model, state)).toBe('# reviewed full note')
  expect(chatCompletion).toHaveBeenCalledTimes(2)
  for (const [usedModel, messages] of jest.mocked(chatCompletion).mock.calls) {
    expect(usedModel).toBe(model)
    expect(messages[1].content).toContain(evidence)
    expect(messages[0].content).not.toMatch(/逐段提取|合并重复事实/)
  }
  expect(jest.mocked(chatCompletion).mock.calls[1][1][1].content).toContain('# complete draft')
  expect(state.save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 11,
    source: evidence, model, parts: { draft: '# complete draft', audit: '# reviewed full note' } }))
  expect(analyze).not.toHaveBeenCalled(); expect(recognizeInterval).not.toHaveBeenCalled()
  expect(JSON.stringify(record)).toBe(before)
})

test.each(['draft', 'audit'])('context rejection at %s never splits, retries or overwrites saved evidence', async at => {
  const error = new ApiError('context_length_exceeded', 400, { code: 'context_length_exceeded' })
  const source = 'original full evidence '.repeat(1000)
  const old = { version: 11, model: 'frozen-summary', title: '会议', source,
    parts: at === 'audit' ? { draft: '# saved draft' } : {} } as SummaryCheckpoint
  const before = JSON.stringify(old), state = options()
  jest.mocked(chatCompletion).mockRejectedValue(error)
  await expect(summarize(source, old.title, old.model, { ...state, checkpoint: old })).rejects.toBe(error)
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  expect(jest.mocked(chatCompletion).mock.calls[0][1][1].content).toContain(source)
  expect(state.save).not.toHaveBeenCalled()
  expect(JSON.stringify(old)).toBe(before)
})

test.each([new TransportError('unknown outcome'), new ApiError('service unavailable', 503)])('failed summary request is not automatically retried: %s', async error => {
  jest.mocked(chatCompletion).mockRejectedValue(error)
  const state = options()
  await expect(summarize('saved source', '会议', 'frozen-summary', state)).rejects.toBe(error)
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  expect(state.save).not.toHaveBeenCalled()
})

test.each(['model', 'title', 'source'])('v11 cache with a different %s cannot replace the explicit summary source/model', async field => {
  const source = 'complete saved evidence '.repeat(500)
  const old = { version: 11, model: 'old-summary', title: 'old title', source: 'old evidence',
    parts: { draft: '# prior draft', audit: '# prior audit' } } as SummaryCheckpoint
  const title = field === 'title' ? 'new title' : old.title
  const model = field === 'model' ? 'explicit-new-summary' : old.model
  const input = field === 'source' ? source : old.source
  const before = JSON.stringify(old)
  jest.mocked(chatCompletion).mockResolvedValue(answer('# fresh full response') as never)
  await summarize(input, title, model, { ...options(), checkpoint: old })
  expect(chatCompletion).toHaveBeenCalledTimes(2)
  for (const [used, messages] of jest.mocked(chatCompletion).mock.calls) {
    expect(used).toBe(model)
    expect(messages[1].content).toContain(input)
    expect(messages[1].content).not.toContain('# prior draft')
  }
  expect(JSON.stringify(old)).toBe(before)
})
