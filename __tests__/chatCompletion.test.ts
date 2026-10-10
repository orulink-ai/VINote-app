import { chatCompletion } from '../src/lib/chatCompletion'
import { apiTextStream } from '../src/lib/api'
import { ApiError, TransportError } from '../src/lib/errors'
import { retry } from '../src/lib/processingHelpers'

jest.mock('../src/lib/api', () => ({ apiTextStream: jest.fn() }))
const wire = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`
const end = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
beforeEach(() => jest.mocked(apiTextStream).mockReset())

test('asks the deployed API for streaming, pins the account and waits for a complete answer', async () => {
  jest.mocked(apiTextStream).mockImplementation(async (_path, _init, receive) => { receive(': ping\n\n'); receive(wire('# 完整纪要')); receive(end) })
  const progress = jest.fn()
  const result = await chatCompletion('llm', [{ role: 'user', content: '证据' }], 'owner-A', progress)
  expect(result.choices[0].message.content).toBe('# 完整纪要')
  expect(JSON.parse(jest.mocked(apiTextStream).mock.calls[0][1].body as string)).toMatchObject({ model: 'llm', stream: true })
  expect(jest.mocked(apiTextStream).mock.calls[0][3]).toBe('owner-A')
  expect(progress).toHaveBeenCalledWith(6)
})

test('a retry uses a fresh collector after a connection loses a partial answer', async () => {
  jest.mocked(apiTextStream).mockImplementationOnce(async (_path, _init, receive) => { receive(wire('不应保存')); throw new TransportError('断线') })
    .mockImplementationOnce(async (_path, _init, receive) => { receive(wire('# 成功')); receive(end) })
  const result = await retry(() => chatCompletion('llm', []), async () => {}, () => {})
  expect(result.choices[0].message.content).toBe('# 成功')
  expect(apiTextStream).toHaveBeenCalledTimes(2)
})

test('model permission denial stays non-retryable and explains preserved progress in Chinese', async () => {
  jest.mocked(apiTextStream).mockRejectedValue(new ApiError('Access to model denied. Please make sure you are eligible for using the model.', 403))
  await expect(retry(() => chatCompletion('llm', []), async () => {}, () => {})).rejects.toThrow('当前纪要模型暂不可用')
  expect(apiTextStream).toHaveBeenCalledTimes(1)
})
