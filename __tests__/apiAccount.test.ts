import { apiJson, apiTextStream } from '../src/lib/api'
import { requestTextStream } from '../src/lib/textStream'
import { timedFetch } from '../src/lib/errors'
import { readSession, saveSession, sessionRevision } from '../src/lib/storage'

jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(), saveSession: jest.fn(), sessionRevision: jest.fn(() => 0) }))
jest.mock('../src/lib/errors', () => ({ ...jest.requireActual('../src/lib/errors'), timedFetch: jest.fn() }))
jest.mock('../src/lib/textStream', () => ({ requestTextStream: jest.fn() }))

const session = (id: string) => ({ user: { id, email: `${id}@example.com` }, access_token: `token-${id}`, refresh_token: `refresh-${id}` })
const response = (status: number, data: unknown) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data) }) as Response
beforeEach(() => { jest.clearAllMocks(); jest.mocked(sessionRevision).mockReturnValue(0) })

test('expected account rejects a switch during asynchronous session read before uploading', async () => {
  let finish!: (value: ReturnType<typeof session>) => void
  jest.mocked(readSession).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const request = apiJson('/v1/asr/transcriptions', { method: 'POST' }, 'account-A')
  finish(session('account-B'))
  await expect(request).rejects.toThrow('账号已切换')
  expect(timedFetch).not.toHaveBeenCalled()
})

test('401 cannot refresh under another account or retry the old upload', async () => {
  jest.mocked(readSession).mockResolvedValueOnce(session('account-A')).mockResolvedValueOnce(session('account-B'))
  jest.mocked(timedFetch).mockResolvedValueOnce(response(401, { error: 'expired' }))
  await expect(apiJson('/v1/asr/transcriptions', { method: 'POST' }, 'account-A')).rejects.toThrow('账号已切换')
  expect(timedFetch).toHaveBeenCalledTimes(1)
  expect(saveSession).not.toHaveBeenCalled()
})

test('ordinary requests remain compatible without an expected account', async () => {
  jest.mocked(readSession).mockResolvedValue(session('account-B'))
  jest.mocked(timedFetch).mockResolvedValue(response(200, { data: [1] }))
  await expect(apiJson('/v1/models')).resolves.toEqual({ data: [1] })
  expect(timedFetch).toHaveBeenCalledTimes(1)
})

test('401 refreshes and retries only when the same account remains active', async () => {
  jest.mocked(readSession).mockResolvedValue(session('account-A'))
  jest.mocked(timedFetch).mockResolvedValueOnce(response(401, { error: 'expired' }))
    .mockResolvedValueOnce(response(200, { ...session('account-A'), access_token: 'new-access' }))
    .mockResolvedValueOnce(response(200, { ok: true }))
  await expect(apiJson('/v1/models', {}, 'account-A')).resolves.toEqual({ ok: true })
  expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'new-access' }))
  expect(timedFetch).toHaveBeenCalledTimes(3)
  const retryHeaders = jest.mocked(timedFetch).mock.calls[2][1].headers as Headers
  expect(retryHeaders.get('Authorization')).toBe('Bearer new-access')
})

test('streaming cannot send or refresh a request belonging to another account', async () => {
  jest.mocked(readSession).mockResolvedValue(session('account-B'))
  await expect(apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')).rejects.toThrow('账号已切换')
  expect(requestTextStream).not.toHaveBeenCalled()
  jest.mocked(readSession).mockResolvedValueOnce(session('account-A')).mockResolvedValueOnce(session('account-B'))
  jest.mocked(requestTextStream).mockResolvedValueOnce({ status: 401, text: '{}', contentType: 'application/json' })
  await expect(apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')).rejects.toThrow('账号已切换')
  expect(requestTextStream).toHaveBeenCalledTimes(1)
})

test('streaming refreshes the same account, rejects HTTP524 and rejects non-SSE success', async () => {
  jest.mocked(readSession).mockResolvedValue(session('account-A'))
  jest.mocked(requestTextStream).mockResolvedValueOnce({ status: 401, text: '{}', contentType: 'application/json' })
    .mockResolvedValueOnce({ status: 200, text: 'data: [DONE]\n\n', contentType: 'text/event-stream' })
  jest.mocked(timedFetch).mockResolvedValueOnce(response(200, { ...session('account-A'), access_token: 'fresh' }))
  await apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')
  expect((jest.mocked(requestTextStream).mock.calls[1][1].headers as Headers).get('Authorization')).toBe('Bearer fresh')
  jest.mocked(requestTextStream).mockResolvedValueOnce({ status: 524, text: '<html>timeout</html>', contentType: 'text/html' })
  await expect(apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')).rejects.toThrow('HTTP 524')
  jest.mocked(requestTextStream).mockResolvedValueOnce({ status: 200, text: '{}', contentType: 'application/json' })
  await expect(apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')).rejects.toThrow('未返回流式响应')
})

test('upstream error code and request id survive without retaining the raw response', async () => {
  jest.mocked(readSession).mockResolvedValue(session('account-A'))
  jest.mocked(requestTextStream).mockResolvedValueOnce({ status: 403, contentType: 'application/json', requestId: 'request-123',
    text: JSON.stringify({ error: { code: 'AccessDenied.Unpurchased', message: 'Access to model denied', private_field: 'must-not-be-stored' } }) })
  await expect(apiTextStream('/chat', { body: '{}' }, jest.fn(), 'account-A')).rejects.toMatchObject({
    status: 403, details: { code: 'AccessDenied.Unpurchased', requestId: 'request-123' },
  })
})
