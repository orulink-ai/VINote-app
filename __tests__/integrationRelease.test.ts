jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'test-token') }))
jest.mock('../src/lib/remoteRequest', () => ({ remoteRequest: jest.fn(() => ({
  scope: { owner: 'alice' }, guard: jest.fn(), close: jest.fn(), context: {}, signal: undefined,
})) }))

jest.mock('../config/deployment.json', () => ({ apiBaseUrl: 'https://models.vinote.app', authBaseUrl: 'https://account.vinote.app', integrationBaseUrl: 'https://account.vinote.app/vinote-api', generationBaseUrl: '' }))

const development = __DEV__
afterEach(() => { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = development; jest.restoreAllMocks(); jest.resetModules() })

test('release content intake fails closed without borrowing VILab or Feishu origins or fetching a token', async () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false
  let integration!: typeof import('../src/lib/integration')
  let readAccountId!: jest.Mock, accessToken!: jest.Mock
  jest.isolateModules(() => {
    integration = require('../src/lib/integration')
    readAccountId = require('../src/lib/storage').readAccountId
    accessToken = require('../src/lib/supabase').accessToken
  })
  const request = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not reach network'))
  expect(integration.generationBaseUrl).toBe('')
  expect(integration.integrationOrigin('/api/generate_from_upload')).toBe('')
  expect(integration.integrationOrigin('/api/feishu/status')).toBe(integration.integrationBaseUrl)
  await expect(integration.integrationJson('/api/generate_from_upload', { method: 'POST' }, 'alice'))
    .rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' })
  expect(request).not.toHaveBeenCalled()
  expect(accessToken).not.toHaveBeenCalled()
  expect(readAccountId).not.toHaveBeenCalled()
})

test('debug content service remains separate from the bundled integration service', () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true
  jest.isolateModules(() => {
    const integration = require('../src/lib/integration') as typeof import('../src/lib/integration')
    expect(integration.integrationOrigin('/api/generate')).toBe('http://127.0.0.1:8900')
    expect(integration.integrationOrigin('/api/mcp-connections')).toBe(integration.integrationBaseUrl)
  })
})
function release(config: Record<string, unknown> = {}) {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false
  jest.doMock('../config/deployment.json', () => ({ apiBaseUrl: 'https://models.vinote.app', authBaseUrl: 'https://account.vinote.app', integrationBaseUrl: 'https://account.vinote.app/vinote-api', generationBaseUrl: 'https://account.vinote.app/vinote-api/', ...config }))
  let value!: typeof import('../src/lib/integration')
  jest.isolateModules(() => { value = require('../src/lib/integration') })
  return value
}
const capabilities = { content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true }
const reply = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value, text: async () => JSON.stringify(value) } as Response)

test('release and embedded dev=false bundle use explicit public content config with authenticated preflight', async () => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply(capabilities)).mockResolvedValueOnce(reply({ task_id: 'synthetic' }))
  expect(api.generationBaseUrl).toBe('https://account.vinote.app/vinote-api')
  await expect(api.integrationJson('/api/generate', { method: 'POST', body: '{"source":"synthetic"}' }, 'alice')).resolves.toEqual({ task_id: 'synthetic' })
  expect(request.mock.calls.map(call => call[0])).toEqual(['https://account.vinote.app/vinote-api/api/content-service/capabilities', 'https://account.vinote.app/vinote-api/api/generate'])
  expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' })
  expect(request.mock.calls[0][1]?.body).toBeUndefined()
  expect(new Headers(request.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer test-token')
  expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"source":"synthetic"}' })
})

test.each([
  [404, {}, 'CONTENT_SERVICE_UNAVAILABLE', '尚未就绪'],
  [403, {}, 'CONTENT_SERVICE_UNAVAILABLE', '无权'],
  [200, { ...capabilities, generation: false }, 'CONTENT_SERVICE_DISABLED', '尚未启用'],
  [200, { ...capabilities, sync: true }, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED', '不兼容'],
  [200, { ...capabilities, content_service_protocol: 2 }, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED', '不兼容'],
  [200, {}, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED', '不兼容'],
  [200, { ...capabilities, max_upload_bytes: undefined }, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED', '文件上限'],
  [200, { ...capabilities, max_upload_bytes: 0 }, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED', '文件上限'],
])('preflight %s %j blocks source POST and reports actionable status', async (status, value, code, copy) => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply(value, status))
  await expect(api.integrationJson('/api/generate', { method: 'POST', body: 'never sent' }, 'alice')).rejects.toMatchObject({ code, message: expect.stringContaining(copy) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1]?.method).toBe('GET')
})

test('capability transport failure is unverified, with no POST or retry', async () => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('synthetic network failure'))
  await expect(api.integrationJson('/api/generate', { method: 'POST' }, 'alice')).rejects.toMatchObject({ code: 'CONTENT_SERVICE_UNVERIFIED' })
  expect(request).toHaveBeenCalledTimes(1)
})

test('preflight permits only one auth refresh and never POSTs if rejected again', async () => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({}, 401))
  await expect(api.integrationJson('/api/generate', { method: 'POST' }, 'alice')).rejects.toMatchObject({ status: 401, message: expect.stringContaining('登录已失效') })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true)
})

test('Feishu stays independent from content capability deployment', async () => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ connected: true }))
  await api.integrationJson('/api/feishu/status', {}, 'alice')
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('https://account.vinote.app/vinote-api/api/feishu/status')
})

test('invalid release model origin fails closed before credentials or fetch', async () => {
  const api = release({ generationBaseUrl: 'https://models.vinote.app' })
  const request = jest.spyOn(globalThis, 'fetch')
  expect(api.generationBaseUrl).toBe('')
  await expect(api.integrationJson('/api/generate', { method: 'POST' }, 'alice')).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' })
  expect(request).not.toHaveBeenCalled()
})

test('public URL configuration also validates with the actual React Native URL parser', () => {
  const original = globalThis.URL
  try {
    globalThis.URL = require('react-native/Libraries/Blob/URL').URL
    expect(release().generationBaseUrl).toBe('https://account.vinote.app/vinote-api')
  } finally { globalThis.URL = original }
})

test.each([null, 'bilibili', { bilibili: true }, [null], ['BILIBILI'], ['bilibili', 'bilibili'], ['*']])('malformed platform rules %j fail before content POST', async video_url_platforms => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ ...capabilities, video_url_platforms }))
  await expect(api.integrationJson('/api/generate', { method: 'POST', body: JSON.stringify({ video_url: 'https://b23.tv/synthetic' }) }, 'alice')).rejects.toMatchObject({ code: 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED' })
  expect(request).toHaveBeenCalledTimes(1)
})

test.each([
  ['https://b23.tv/synthetic', true],
  ['https://www.bilibili.com/video/BVsynthetic', true],
  ['https://youtu.be/synthetic', false],
  ['https://media.example/synthetic.mp4', false],
])('public API rechecks explicit Bilibili platform scope for %s', async (url, allowed) => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ ...capabilities, video_url: true, video_url_platforms: ['bilibili'] })).mockResolvedValueOnce(reply({ task_id: 'synthetic' }))
  const work = api.integrationJson('/api/generate', { method: 'POST', body: JSON.stringify({ video_url: url }) }, 'alice')
  if (allowed) await expect(work).resolves.toEqual({ task_id: 'synthetic' })
  else await expect(work).rejects.toMatchObject({ code: 'VIDEO_URL_PLATFORM_UNAVAILABLE' })
  expect(request).toHaveBeenCalledTimes(allowed ? 2 : 1)
})

test('Bilibili capability is not a success guarantee: source 412 stays visible and never replays POST', async () => {
  const api = release()
  const detail = '源站暂时拒绝访问（HTTP 412），请稍后核验或导入文件。'
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ ...capabilities, video_url: true, video_url_platforms: ['bilibili'] })).mockResolvedValueOnce(reply({ detail }, 412))
  await expect(api.integrationJson('/api/generate', { method: 'POST', body: JSON.stringify({ video_url: 'https://www.bilibili.com/video/BVsynthetic' }) }, 'alice')).rejects.toMatchObject({ status: 412, message: detail })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
})

test.each(['https://b23.tv/synthetic', 'https://python.org/about'])('master video switch remains authoritative without blocking ordinary webpages: %s', async url => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ ...capabilities, video_url: false, video_url_platforms: ['bilibili'] })).mockResolvedValueOnce(reply({ task_id: 'synthetic' }))
  const work = api.integrationJson('/api/generate', { method: 'POST', body: JSON.stringify({ video_url: url }) }, 'alice')
  if (url.includes('b23.tv')) {
    await expect(work).rejects.toMatchObject({ code: 'VIDEO_URL_PLATFORM_UNAVAILABLE' })
    expect(request).toHaveBeenCalledTimes(1)
  } else {
    await expect(work).resolves.toEqual({ task_id: 'synthetic' })
    expect(request).toHaveBeenCalledTimes(2)
  }
})

test.each([0, 2, '1', null, true])('invalid optional source preflight protocol %j blocks content dispatch', async video_source_preflight => {
  const api = release()
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ ...capabilities, video_source_preflight }))
  await expect(api.integrationJson('/api/generate', { method: 'POST' }, 'alice')).rejects.toMatchObject({ code: 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED' })
  expect(request).toHaveBeenCalledTimes(1)
})

test('optional source preflight protocol 1 is accepted and source errors retain safe detail', async () => {
  const api = release()
  const detail = 'B站来源受限（HTTP 412），请稍后核验。'
  const request = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ ...capabilities, video_source_preflight: 1 })).mockResolvedValueOnce(reply({ detail }, 502))
  await expect(api.integrationJson('/api/content-service/video-source', { method: 'POST', body: JSON.stringify({ url: 'https://b23.tv/synthetic' }) }, 'alice', 60000)).rejects.toMatchObject({ status: 502, message: detail })
  expect(request).toHaveBeenCalledTimes(2)
  expect(new Headers(request.mock.calls[1][1]?.headers).has('X-VINote-Operation-Id')).toBe(false)
})
