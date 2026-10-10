import { OpenAiStream } from '../src/lib/openAiStream'

const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`
const chunk = (content: string, index = 0) => ({ choices: [{ index, delta: { content }, finish_reason: null }] })
const stop = event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })

test('fragmented Chinese SSE, comments, reasoning and usage produce only the complete first answer', () => {
  const seen: number[] = []
  const stream = new OpenAiStream(chars => seen.push(chars))
  const wire = ': keep-alive\r\n\r\n' + event({ choices: [{ index: 0, delta: { reasoning_content: '不展示' } }] }) +
    event(chunk('# 方案交流\n')) + event(chunk('忽略其他候选', 1)) + event(chunk('保留不同观点。')) + stop +
    event({ choices: [], usage: { total_tokens: 10 } }) + 'data: [DONE]\r\n\r\n'
  for (let offset = 0; offset < wire.length; offset += 7) stream.push(wire.slice(offset, offset + 7))
  expect(stream.finish().choices[0].message.content).toBe('# 方案交流\n保留不同观点。')
  expect(seen).toEqual([7, 14])
})

test('EOF or DONE without an explicit successful finish rejects partial text', () => {
  const missingDone = new OpenAiStream()
  missingDone.push(event(chunk('半份')) + stop)
  expect(() => missingDone.finish()).toThrow('未完整结束')
  const missingStop = new OpenAiStream()
  missingStop.push(event(chunk('半份')) + 'data: [DONE]\n\n')
  expect(() => missingStop.finish()).toThrow('未完整结束')
})

test('length, filtered, empty, malformed and upstream error responses cannot become notes', () => {
  for (const reason of ['length', 'content_filter']) {
    const stream = new OpenAiStream()
    stream.push(event(chunk('部分')) + event({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) + 'data: [DONE]\n\n')
    expect(() => stream.finish()).toThrow()
  }
  const empty = new OpenAiStream()
  empty.push(stop + 'data: [DONE]\n\n')
  expect(() => empty.finish()).toThrow('没有返回')
  expect(() => new OpenAiStream().push('data: invalid\n\n')).toThrow('无效')
  expect(() => new OpenAiStream().push(event({ error: { message: 'upstream private details' } }))).toThrow('流式处理失败')
})
