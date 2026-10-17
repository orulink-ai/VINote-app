jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'test-token') }))
jest.mock('../src/lib/remoteRequest', () => ({ remoteRequest: jest.fn(() => ({
  scope: { owner: 'alice' }, guard: jest.fn(), close: jest.fn(), context: {}, signal: undefined,
})) }))

const development = __DEV__
afterEach(() => { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = development; jest.restoreAllMocks() })

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
