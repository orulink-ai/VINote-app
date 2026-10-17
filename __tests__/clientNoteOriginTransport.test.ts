import Storage from '@react-native-async-storage/async-storage'
import { API_BASE_URL } from '../src/config/env'
import { prepareClientNote, launchClientNote, readClientNote } from '../src/lib/clientNotePipeline'
import { requestTextStream } from '../src/lib/textStream'
import { integrationJson } from '../src/lib/integration'

jest.mock('../src/config/env', () => ({ API_BASE_URL: 'http://192.168.1.143:9876' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: async () => 'owner', readSession: async () => ({ user: { id: 'owner' }, access_token: 'fixture' }) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn() }))
jest.mock('../src/lib/sessionIdentity', () => ({ identityEpoch: () => 1 }))
jest.mock('../src/lib/sessionGate', () => ({ captureRemoteScope: () => ({ owner: 'owner' }), assertRemoteScope: jest.fn() }))
jest.mock('../src/lib/remoteRequest', () => ({ remoteRequest: () => ({ scope: { owner: 'owner' }, guard: () => {}, close: () => {}, signal: undefined }) }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://shared.example/vinote-api', operationId: () => '11111111-1111-4111-8111-111111111111', verifyContentService: async () => ({ text_extraction_protocol: 1, max_upload_bytes: 10000 }), integrationJson: jest.fn(async () => ({ extraction_protocol: 1, title: '文章', text: '来源正文', source_sha256: 'a'.repeat(64), source_type: 'webpage' })) }))
jest.mock('../src/lib/models', () => ({ loadSelection: async () => ({ asr_model: 'same-asr-id', llm_model: 'same-llm-id' }), loadModels: async () => [{ id: 'same-llm-id', modelType: 'llm', runtimeStatus: 'available' }] }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn() }))
jest.mock('../src/lib/textStream', () => ({ requestTextStream: jest.fn() }))

test('real chatCompletion + SSE collector send equal model IDs only to each fixed package origin', async () => {
  const env = require('../src/config/env') as { API_BASE_URL: string }
  const previous = API_BASE_URL
  jest.mocked(requestTextStream).mockImplementation(async (_url, _init, receive) => {
    receive('data: {"choices":[{"index":0,"delta":{"content":"# 真实收集器正文"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    return { status: 200, text: '', contentType: 'text/event-stream' }
  })
  try {
    for (const origin of ['http://192.168.1.143:9876', 'https://api.orulink.ai']) {
      for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
      env.API_BASE_URL = origin
      const receipt = await prepareClientNote('owner', { mode: 'url', url: `https://article.example/${origin.startsWith('http:') ? 'lan' : 'public'}`, sourceType: 'file' })
      await launchClientNote('owner', receipt)
      expect((await readClientNote('owner', receipt)).result?.markdown).toBe('# 真实收集器正文')
      const [url, init] = jest.mocked(requestTextStream).mock.calls.at(-1)!
      expect(url).toBe(origin + '/openai/v1/chat/completions')
      expect(JSON.parse(init.body as string).model).toBe('same-llm-id')
      expect((await readClientNote('owner', receipt)).modelOrigin).toBe(origin)
    }
    expect(requestTextStream).toHaveBeenCalledTimes(2)
    expect(jest.mocked(integrationJson).mock.calls.every(call => call[0] === '/api/content-service/extract-url' && !String(call[1]?.body).includes('model'))).toBe(true)
  } finally { env.API_BASE_URL = previous }
})
