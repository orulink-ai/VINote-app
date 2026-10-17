import Storage from '@react-native-async-storage/async-storage'
import { prepareClientNote, launchClientNote, readClientNote, retryClientNote } from '../src/lib/clientNotePipeline'
import { beginVerification, finishVerification } from '../src/lib/sessionGate'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { apiTextStream } from '../src/lib/api'
import { ModelRequestNotSent } from '../src/lib/errors'

jest.mock('../src/config/env', () => ({ API_BASE_URL: 'http://192.168.1.143:9876', AUTH_BASE_URL: 'https://accounts.example' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: async () => 'owner', readSession: async () => ({ user: { id: 'owner' }, access_token: 'fixture' }) }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadSelection: async () => ({ asr_model: 'same-asr', llm_model: 'same-llm' }), loadModels: async () => [{ id: 'same-llm', modelType: 'llm', runtimeStatus: 'available' }] }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://extract.example', operationId: () => '11111111-1111-4111-8111-111111111111', verifyContentService: async () => ({ text_extraction_protocol: 1, max_upload_bytes: 10000 }), integrationJson: async () => ({ extraction_protocol: 1, title: '来源', text: '正文', source_sha256: 'a'.repeat(64), source_type: 'webpage' }) }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn() }))
const previousXHR = globalThis.XMLHttpRequest
let failOpen = false
let checkingOnSend = false
let verification: ReturnType<typeof beginVerification> | undefined
let sends = 0
class XHR {
  status = 200
  responseText = 'data: {"choices":[{"index":0,"delta":{"content":"# 已完成笔记"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  onload?: () => void; onabort?: () => void; onprogress?: () => void
  open() { if (failOpen) throw new Error('setup rejected') } setRequestHeader() {}
  getResponseHeader(name: string) { return name.toLowerCase() === 'content-type' ? 'text/event-stream' : '' }
  abort() { this.onabort?.() }
  send() {
    sends++
    if (checkingOnSend) verification = beginVerification('owner')
    this.onload?.()
  }
}
beforeEach(async () => {
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  transitionIdentity('owner'); finishVerification(beginVerification('owner'), 'verified')
  failOpen = false; checkingOnSend = false; verification = undefined; sends = 0
  globalThis.XMLHttpRequest = XHR as never
})
afterEach(() => { globalThis.XMLHttpRequest = previousXHR })
const source = { mode: 'url' as const, url: 'https://article.example', sourceType: 'file' }
test('real gate checking before HTTP yields a typed not-sent proof and manual continuation sends exactly once', async () => {
  const receipt = await prepareClientNote('owner', source)
  const original = jest.mocked(Storage.setItem).getMockImplementation()!
  let checking = true
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    await original(key, value)
    if (checking && key.includes(':client-note:') && JSON.parse(value).inFlight === 'llm') {
      checking = false; verification = beginVerification('owner')
    }
  })
  try {
    await launchClientNote('owner', receipt)
    expect(sends).toBe(0)
    const record = await readClientNote('owner', receipt)
    expect(record).toMatchObject({ status: 'failed', retryable: true })
    expect(record.inFlight).toBeUndefined()
    await expect(apiTextStream('/openai/v1/chat/completions', { method: 'POST', body: '{}' }, jest.fn(), 'owner')).rejects.toBeInstanceOf(ModelRequestNotSent)
    finishVerification(verification!, 'verified')
    await retryClientNote('owner', receipt)
    expect(sends).toBe(1)
    expect((await readClientNote('owner', receipt)).result?.markdown).toBe('# 已完成笔记')
  } finally { jest.mocked(Storage.setItem).mockImplementation(original) }
})
test('same checking failure after real send is unknown and cannot clear its marker or replay', async () => {
  const receipt = await prepareClientNote('owner', source)
  checkingOnSend = true
  await launchClientNote('owner', receipt)
  expect(sends).toBe(1)
  const record = await readClientNote('owner', receipt)
  expect(record).toMatchObject({ status: 'unknown', inFlight: 'llm', retryable: false })
  finishVerification(verification!, 'verified')
  await expect(retryClientNote('owner', receipt)).rejects.toThrow('未确认')
  expect(sends).toBe(1)
})

test('real XHR setup failure before send is provably unsent and can explicitly continue', async () => {
  const receipt = await prepareClientNote('owner', source)
  failOpen = true
  await launchClientNote('owner', receipt)
  expect(sends).toBe(0)
  expect(await readClientNote('owner', receipt)).toMatchObject({ status: 'failed', retryable: true })
  failOpen = false
  await retryClientNote('owner', receipt)
  expect(sends).toBe(1)
  expect((await readClientNote('owner', receipt)).result?.markdown).toBe('# 已完成笔记')
})
