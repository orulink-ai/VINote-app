import { requestTextStream } from '../src/lib/textStream'
import { TransportError } from '../src/lib/errors'

class FakeXHR {
  static latest: FakeXHR
  static throwAt: 'open' | 'setRequestHeader' | 'send' | undefined
  status = 200
  responseText = ''
  contentType = 'text/event-stream; charset=utf-8'
  onload: (() => void) | null = null
  onprogress: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  timeout = 0
  withCredentials = true
  responseType = ''
  open = jest.fn()
  setRequestHeader = jest.fn()
  send = jest.fn()
  abort = jest.fn()
  getResponseHeader = jest.fn(() => this.contentType)
  constructor() {
    FakeXHR.latest = this
    if (FakeXHR.throwAt) this[FakeXHR.throwAt].mockImplementation(() => { throw new Error('同步发送失败') })
  }
}
const original = globalThis.XMLHttpRequest
beforeEach(() => { FakeXHR.throwAt = undefined; globalThis.XMLHttpRequest = FakeXHR as never })
afterEach(() => { globalThis.XMLHttpRequest = original })

test('incremental text arrives before load and final unread bytes arrive once', async () => {
  const receive = jest.fn()
  const result = requestTextStream('https://example.test/chat', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}' }, receive)
  const xhr = FakeXHR.latest
  xhr.responseText = '第一包'; xhr.onprogress!()
  expect(receive).toHaveBeenCalledWith('第一包')
  xhr.onprogress!()
  xhr.responseText += '第二包'; xhr.onload!()
  await expect(result).resolves.toMatchObject({ status: 200 })
  expect(receive.mock.calls).toEqual([['第一包'], ['第二包']])
  expect(xhr.timeout).toBe(900000)
  expect(xhr.withCredentials).toBe(false)
  expect(xhr.onprogress).toBeNull()
})

test('HTTP errors and JSON bodies are never dispatched as successful stream data', async () => {
  const receive = jest.fn()
  const request = requestTextStream('https://example.test/chat', { body: '{}' }, receive)
  const xhr = FakeXHR.latest
  xhr.status = 401; xhr.responseText = '{"message":"expired"}'; xhr.contentType = 'application/json'
  xhr.onprogress!(); xhr.onload!()
  await expect(request).resolves.toMatchObject({ status: 401 })
  expect(receive).not.toHaveBeenCalled()
})

test('a completed XHR without an HTTP status remains a retryable transport failure', async () => {
  const receive = jest.fn()
  const request = requestTextStream('https://example.test/chat', { body: '{}' }, receive)
  const xhr = FakeXHR.latest
  xhr.status = 0
  xhr.onload!()
  await expect(request).rejects.toBeInstanceOf(TransportError)
  expect(receive).not.toHaveBeenCalled()
  expect(xhr.onprogress).toBeNull()
})

test('a parser failure aborts the connection and removes every handler', async () => {
  const request = requestTextStream('https://example.test/chat', { body: '{}' }, () => { throw new Error('无效数据') })
  const xhr = FakeXHR.latest
  xhr.responseText = 'invalid'; xhr.onprogress!()
  await expect(request).rejects.toThrow('无效数据')
  expect(xhr.abort).toHaveBeenCalledTimes(1)
  expect([xhr.onload, xhr.onprogress, xhr.onerror, xhr.ontimeout, xhr.onabort]).toEqual([null, null, null, null, null])
})

test.each(['onerror', 'ontimeout', 'onabort'] as const)('%s rejects instead of accepting buffered partial text', async name => {
  const request = requestTextStream('https://example.test/chat', { body: '{}' }, () => {})
  const xhr = FakeXHR.latest
  xhr.responseText = 'partial'; xhr[name]!()
  await expect(request).rejects.toThrow()
  expect(xhr.abort).toHaveBeenCalled()
})

test('a live stream beyond 125 seconds continues receiving and resolves only at completion', async () => {
  jest.useFakeTimers()
  try {
    const receive = jest.fn()
    let finished = false
    const request = requestTextStream('https://example.test/chat', { body: '{}' }, receive).then(() => { finished = true })
    const xhr = FakeXHR.latest
    xhr.responseText = ': keep-alive\n\n'; xhr.onprogress!()
    await jest.advanceTimersByTimeAsync(128000)
    expect(finished).toBe(false)
    xhr.responseText += 'data: complete\n\n'; xhr.onprogress!(); xhr.onload!()
    await request
    expect(finished).toBe(true)
    expect(receive).toHaveBeenCalledTimes(2)
  } finally { jest.useRealTimers() }
})

test('continuous keep-alives cannot extend the total request beyond fifteen minutes', async () => {
  jest.useFakeTimers()
  try {
    let rejection: unknown
    const request = requestTextStream('https://example.test/chat', { body: '{}' }, jest.fn())
      .catch(error => { rejection = error })
    const xhr = FakeXHR.latest
    for (let minute = 0; minute < 14; minute++) {
      await jest.advanceTimersByTimeAsync(60000)
      xhr.responseText += ': keep-alive\n\n'; xhr.onprogress!()
    }
    await jest.advanceTimersByTimeAsync(59999)
    expect(xhr.abort).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(xhr.abort).toHaveBeenCalledTimes(1)
    await request
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toContain('超过时间上限')
    expect([xhr.onload, xhr.onprogress, xhr.onerror, xhr.ontimeout, xhr.onabort]).toEqual([null, null, null, null, null])
    expect(jest.getTimerCount()).toBe(0)
  } finally { jest.clearAllTimers(); jest.useRealTimers() }
})

test.each(['open', 'setRequestHeader', 'send'] as const)('a synchronous %s failure releases resources and rejects', async phase => {
  jest.useFakeTimers()
  try {
    FakeXHR.throwAt = phase
    const request = requestTextStream('https://example.test/chat', { headers: { Accept: 'text/event-stream' }, body: '{}' }, jest.fn())
    await expect(request).rejects.toThrow('同步发送失败')
    const xhr = FakeXHR.latest
    expect(xhr.abort).toHaveBeenCalledTimes(1)
    expect([xhr.onload, xhr.onprogress, xhr.onerror, xhr.ontimeout, xhr.onabort]).toEqual([null, null, null, null, null])
    expect(jest.getTimerCount()).toBe(0)
  } finally { jest.clearAllTimers(); jest.useRealTimers() }
})

test.each(['onload', 'onerror', 'ontimeout', 'onabort'] as const)('%s cancels the total deadline so a finished request is never aborted later', async phase => {
  jest.useFakeTimers()
  try {
    const request = requestTextStream('https://example.test/chat', { body: '{}' }, jest.fn()).catch(() => {})
    const xhr = FakeXHR.latest
    xhr[phase]!()
    await request
    expect(jest.getTimerCount()).toBe(0)
    const aborts = xhr.abort.mock.calls.length
    await jest.advanceTimersByTimeAsync(900000)
    expect(xhr.abort).toHaveBeenCalledTimes(aborts)
  } finally { jest.clearAllTimers(); jest.useRealTimers() }
})
