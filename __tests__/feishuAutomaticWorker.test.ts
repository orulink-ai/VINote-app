import { processFeishuAutomatic } from '../src/lib/feishuAutomaticWorker'
import { readFeishuAutomatic } from '../src/lib/feishuAutomaticQueue'
import { readPublishDraft } from '../src/lib/feishuPublishReceipt'
import { publishToFeishu } from '../src/lib/feishu'

jest.mock('../src/lib/feishuAutomaticQueue', () => ({ readFeishuAutomatic: jest.fn() }))
jest.mock('../src/lib/feishuPublishReceipt', () => ({ readPublishDraft: jest.fn(), queryPublishReceipt: jest.fn(), persistPublishDraft: jest.fn(), beginPublishAttempt: jest.fn(), newPublishDraft: jest.fn() }))
jest.mock('../src/lib/feishu', () => ({ publishToFeishu: jest.fn(), feishuApi: jest.fn() }))
jest.mock('../src/lib/feishuAutoConsent', () => ({ readFeishuAutoConsent: jest.fn() }))
jest.mock('../src/lib/feishuLocalPreferences', () => ({ readFeishuLocalPreferences: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ getNote: jest.fn() }))
jest.mock('../src/lib/feishuPublishReview', () => ({ publishOptionsSignature: jest.fn(), reviewPublishOptions: jest.fn() }))
jest.mock('../src/lib/feishuDevicePayload', () => ({ validateDevicePayload: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

test('an unresolved original submission is queried and never submitted again', async () => {
  const intent = { owner: 'owner', note: { id: 'note', title: '标题', content: '正文' }, operationId: 'operation', consent: {}, options: {}, state: 'prepared' }
  jest.mocked(readFeishuAutomatic).mockResolvedValue(intent as never)
  jest.mocked(readPublishDraft).mockResolvedValue({ owner: 'owner', noteKey: 'note', operationId: 'operation', state: 'unknown' } as never)
  const { queryPublishReceipt } = require('../src/lib/feishuPublishReceipt')
  require('../src/lib/feishu').feishuApi.mockResolvedValue({ state: 'accepted', operation_id: 'operation' })
  queryPublishReceipt.mockRejectedValue(new Error('仍待确认'))
  await expect(processFeishuAutomatic('owner', 'note')).rejects.toThrow('仍待确认')
  expect(queryPublishReceipt).toHaveBeenCalledTimes(1)
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('queued accepted operation resumes only its own server job', async () => {
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'fingerprint', consentId: 'id' }
  const intent = { owner: 'owner', origin: 'server', note: { id: 'note', title: '标题', content: '正文' }, operationId: 'operation', consent, options: {}, state: 'prepared' as const }
  jest.mocked(readFeishuAutomatic).mockResolvedValue(intent)
  const draft = { owner: 'owner', noteKey: 'note', operationId: 'operation', state: 'acknowledged' }
  jest.mocked(readPublishDraft).mockResolvedValue(draft as never)
  require('../src/lib/feishuPublishReceipt').queryPublishReceipt.mockResolvedValue({ draft, job: { id: 'original-job', status: 'queued' } })
  require('../src/lib/feishuAutoConsent').readFeishuAutoConsent.mockResolvedValue(consent)
  await processFeishuAutomatic('owner', 'note')
  expect(require('../src/lib/feishu').feishuApi).toHaveBeenCalledWith('/deliveries/original-job/resume-device', expect.objectContaining({ method: 'POST' }), 'owner')
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('a changed Feishu connection stops the prepared task without sending', async () => {
  const consent = { connectionBinding: 'old', settingsFingerprint: 'fingerprint', consentId: 'id' }
  const options = { notify_self: true, groups: [] }
  jest.mocked(readFeishuAutomatic).mockResolvedValue({ owner: 'owner', origin: 'server', note: { id: 'note', title: '标题', content: '正文' }, operationId: 'op', consent, options, state: 'prepared' })
  jest.mocked(readPublishDraft).mockResolvedValue(null)
  require('../src/lib/feishuAutoConsent').readFeishuAutoConsent.mockResolvedValue(consent)
  require('../src/lib/feishuLocalPreferences').readFeishuLocalPreferences.mockResolvedValue(options)
  require('../src/lib/feishu').newSnapshotPublishOptions = (v: unknown) => v
  require('../src/lib/feishuPublishReview').publishOptionsSignature.mockReturnValue('fingerprint')
  require('../src/lib/notes').getNote.mockResolvedValue({ id: 'note', title: '标题', content: '正文', status: 'done' })
  require('../src/lib/feishu').feishuApi.mockResolvedValue({ device_bound_publish_protocol: 1, connection_binding_hash: 'new' })
  await expect(processFeishuAutomatic('owner', 'note')).rejects.toThrow('连接已变化')
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('revoking and enabling the same settings cannot revive the old consent', async () => {
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'fingerprint', consentId: 'old-consent' }
  jest.mocked(readFeishuAutomatic).mockResolvedValue({ owner: 'owner', origin: 'server', note: { id: 'note', title: '标题', content: '正文' }, operationId: 'op', consent, options: {}, state: 'prepared' })
  jest.mocked(readPublishDraft).mockResolvedValue(null)
  require('../src/lib/feishuAutoConsent').readFeishuAutoConsent.mockResolvedValue({ ...consent, consentId: 'new-consent' })
  await expect(processFeishuAutomatic('owner', 'note')).rejects.toThrow('关闭或变化')
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('a verified saved note uses one bound operation and records its receipt', async () => {
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'fingerprint', consentId: 'id' }
  const note = { id: 'note', title: '标题', content: '正文' }
  const options = { notify_self: true, groups: [] }
  const intent = { owner: 'owner', origin: 'server', note, operationId: 'op', consent, options, state: 'prepared' as const }
  jest.mocked(readFeishuAutomatic).mockResolvedValue(intent)
  jest.mocked(readPublishDraft).mockResolvedValue(null)
  require('../src/lib/feishuAutoConsent').readFeishuAutoConsent.mockResolvedValue(consent)
  require('../src/lib/feishuLocalPreferences').readFeishuLocalPreferences.mockResolvedValue(options)
  const api = require('../src/lib/feishu')
  api.newSnapshotPublishOptions = (v: unknown) => v
  api.assertFeishuPublishReady = jest.fn()
  api.feishuApi.mockResolvedValue({ device_bound_publish_protocol: 1, connection_binding_hash: 'binding' })
  api.publishToFeishu.mockResolvedValue({ id: 'job', operation_id: 'op' })
  require('../src/lib/feishuPublishReview').publishOptionsSignature.mockReturnValue('fingerprint')
  require('../src/lib/feishuPublishReview').reviewPublishOptions.mockResolvedValue({})
  require('../src/lib/notes').getNote.mockResolvedValue({ ...note, status: 'done' })
  const receipts = require('../src/lib/feishuPublishReceipt')
  receipts.newPublishDraft.mockReturnValue({ owner: 'owner', noteKey: 'note', publicationKey: 'publish:note', snapshot: note, options, state: 'draft' })
  receipts.beginPublishAttempt.mockImplementation(async (draft: object) => ({ draft: { ...draft, state: 'unknown' }, attempt: {} }))
  await processFeishuAutomatic('owner', 'note')
  expect(api.publishToFeishu).toHaveBeenCalledTimes(1)
  expect(api.publishToFeishu.mock.calls[0][5]).toMatchObject({ operation_id: 'op', expected_connection_binding: 'binding', notify_self: true })
  expect(receipts.persistPublishDraft).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'acknowledged', jobId: 'job', operationId: 'op' }))
})
