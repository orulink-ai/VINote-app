import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from '../src/lib/storage'
import { deliveryById, deliveryByOperation } from '../src/lib/feishu'
import { newPublishDraft, persistPublishDraft, readPublishDraft, queryPublishReceipt } from '../src/lib/feishuPublishReceipt'
import { publishOptionsSignature } from '../src/lib/feishuPublishReview'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'a') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: jest.fn(() => 'operation-a') }))
jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, deliveryById: jest.fn(), deliveryByOperation: jest.fn() }))
beforeEach(async () => {
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.clearAllMocks(); jest.mocked(readAccountId).mockReset().mockResolvedValue('a')
})
const draft = () => newPublishDraft('a', 'note', { title: '冻结标题', content: '冻结正文', versionId: 'version', revisionId: '2' }, { destination_config: { kind: 'personal' }, notify_self: false, groups: [] })
test('unknown survives reopen and 404; only exact original GET is attempted', async () => {
  const intent = { ...draft(), state: 'unknown' as const }; await persistPublishDraft(intent)
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('404'))
  await expect(queryPublishReceipt((await readPublishDraft('a', 'note'))!)).rejects.toThrow('404')
  expect(deliveryByOperation).toHaveBeenCalledWith('operation-a', 'a')
  expect(deliveryById).not.toHaveBeenCalled()
  expect(await readPublishDraft('a', 'note')).toMatchObject({ state: 'unknown', snapshot: { content: '冻结正文' } })
})
test('unknown cannot change options, source version, or operation', async () => {
  const intent = { ...draft(), state: 'unknown' as const }; await persistPublishDraft(intent)
  await expect(persistPublishDraft({ ...intent, options: { ...intent.options, notify_self: true } })).rejects.toThrow('不能改变')
  await expect(persistPublishDraft({ ...intent, snapshot: { ...intent.snapshot, versionId: 'other' } })).rejects.toThrow('不能改变')
  await expect(persistPublishDraft({ ...intent, operationId: 'other' })).rejects.toThrow()
  await expect(persistPublishDraft({ ...intent, state: 'draft' })).rejects.toThrow('不能改变')
})
test('verified exact job transitions to acknowledged and later queries that id', async () => {
  const intent = { ...draft(), state: 'unknown' as const }; await persistPublishDraft(intent)
  jest.mocked(deliveryByOperation).mockResolvedValue({ id: 'job', operation_id: intent.operationId, status: 'queued', document_url: '', recipients: {}, error: '' })
  const result = await queryPublishReceipt(intent)
  jest.mocked(deliveryById).mockResolvedValue(result.job)
  await queryPublishReceipt(result.draft)
  expect(deliveryById).toHaveBeenCalledWith('job', 'a')
  expect((await readPublishDraft('a', 'note'))?.state).toBe('acknowledged')
})
test('wrong receipt and owner switch leave original unknown untouched', async () => {
  const intent = { ...draft(), state: 'unknown' as const }; await persistPublishDraft(intent)
  jest.mocked(deliveryByOperation).mockResolvedValue({ id: 'other', operation_id: 'different', status: 'queued', document_url: '', recipients: {}, error: '' })
  await expect(queryPublishReceipt(intent)).rejects.toThrow('不属于')
  jest.mocked(readAccountId).mockResolvedValue('b')
  await expect(persistPublishDraft(intent)).rejects.toThrow('账号')
  expect(await Storage.getItem('vinote:b:feishu-publish:note')).toBeNull()
  jest.mocked(readAccountId).mockResolvedValue('a')
  expect((await readPublishDraft('a', 'note'))?.state).toBe('unknown')
})
test('queued stale draft save cannot unlock the durable unknown', async () => {
  const original = draft(); await persistPublishDraft(original)
  await persistPublishDraft({ ...original, state: 'unknown' })
  await expect(persistPublishDraft(original)).rejects.toThrow('不能改变')
})

test('submitted display evidence cannot be relabelled even without changing remote options', async () => {
  const original = draft()
  const review = { optionsSignature: publishOptionsSignature(original.options), groups: [], destination: { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_create: true } }
  const intent = { ...original, review, state: 'unknown' as const }; await persistPublishDraft(intent)
  await expect(persistPublishDraft({ ...intent, review: { ...review, destination: { ...review.destination, name: '另一个位置', path: ['另一个位置'] } } })).rejects.toThrow('已冻结')
  expect((await readPublishDraft('a', 'note'))?.review).toEqual(review)
})

test('contact names and proofs remain frozen while exact receipt queries do not POST', async () => {
  const original = draft()
  const intent = { ...original, state: 'unknown' as const, options: { ...original.options, contacts: [{ open_id: 'ou_one', selection_token: 'proof', name: '原姓名', expiresAt: 123 }] } }
  await persistPublishDraft(intent)
  await expect(persistPublishDraft({ ...intent, options: { ...intent.options, contacts: [{ ...intent.options.contacts[0], name: '不同姓名' }] } })).rejects.toThrow('不能改变')
  await expect(persistPublishDraft({ ...intent, options: { ...intent.options, contacts: [] } })).rejects.toThrow('不能改变')
  expect((await readPublishDraft('a', 'note'))?.options.contacts).toEqual(intent.options.contacts)
})

test('a same-account return after an epoch change does not acknowledge a stale receipt', async () => {
  const intent = { ...draft(), state: 'unknown' as const }; await persistPublishDraft(intent)
  jest.mocked(deliveryByOperation).mockImplementation(async () => {
    transitionIdentity('b'); transitionIdentity('a')
    return { id: 'job', operation_id: intent.operationId, status: 'queued', document_url: '', recipients: {}, error: '' }
  })
  await expect(queryPublishReceipt(intent)).rejects.toThrow('账号已切换')
  expect((await readPublishDraft('a', 'note'))?.state).toBe('unknown')
})
