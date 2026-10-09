import { apiJson } from '../src/lib/api'
import { timedFetch } from '../src/lib/errors'
import { readSession, saveSession, sessionRevision } from '../src/lib/storage'

jest.mock('../src/lib/storage', () => ({ readSession: jest.fn(), saveSession: jest.fn(), sessionRevision: jest.fn(() => 0) }))
jest.mock('../src/lib/errors', () => ({ ...jest.requireActual('../src/lib/errors'), timedFetch: jest.fn() }))

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
