import Storage from '@react-native-async-storage/async-storage'
import { beginPublishAttempt, newPublishDraft, persistPublishDraft, readPublishDraft, restoreUndispatchedPublish } from '../src/lib/feishuPublishReceipt'
import { publishToFeishu, FeishuPreflightError, newSnapshotPublishOptions, feishuPublishBody } from '../src/lib/feishu'
import { publishOptionsSignature } from '../src/lib/feishuPublishReview'
import { integrationJson } from '../src/lib/integration'
import { connectorPluginKey } from '../src/lib/connectorPlugins'
import { identityEpoch, transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://integration.test', operationId: () => 'operation', integrationJson: jest.fn(), IntegrationError: class extends Error {} }))
beforeEach(async () => {
  jest.clearAllMocks(); transitionIdentity('owner')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
async function begin() {
  const draft = newPublishDraft('owner', 'note', { title: '保存标题', content: '保存正文', versionId: 'old-workspace', revisionId: '2' }, { notify_self: false, groups: [] })
  await persistPublishDraft(draft)
  return beginPublishAttempt(draft)
}
async function call(value: Awaited<ReturnType<typeof begin>>) {
  return publishToFeishu(value.draft.publicationKey || value.draft.noteKey, value.draft.snapshot.title, value.draft.snapshot.content, false, 'owner', { ...value.draft.options, operation_id: value.draft.operationId }, value.attempt)
}
test('late plugin rejection proves zero POST and restores only current attempt with same operation', async () => {
  const value = await begin()
  let error: unknown
  try { await call(value) } catch (cause) { error = cause }
  expect(error).toBeInstanceOf(FeishuPreflightError)
  expect(integrationJson).not.toHaveBeenCalled()
  const restored = await restoreUndispatchedPublish(value.draft, value.attempt, error)
  expect(restored).toMatchObject({ state: 'draft', operationId: 'operation', publicationKey: 'publish:note' })
  await expect(restoreUndispatchedPublish(value.draft, value.attempt, error)).rejects.toThrow()
})
test('fabricated not_dispatched cannot unlock and historical unknown cannot mint attempt', async () => {
  const value = await begin()
  await expect(restoreUndispatchedPublish(value.draft, value.attempt, new FeishuPreflightError())).rejects.toThrow('证明')
  await expect(beginPublishAttempt({ ...value.draft, state: 'draft' })).rejects.toThrow('attempt')
  expect((await readPublishDraft('owner', 'note'))?.state).toBe('unknown')
})
test('HTTP ambiguity retains unknown; new payload uses device snapshot and publish key without workspace identifiers', async () => {
  const value = await begin()
  await Storage.setItem(connectorPluginKey('owner'), JSON.stringify({ version: 1, feishu: { installed: true, enabled: true } }))
  const failure = new Error('transport unknown')
  jest.mocked(integrationJson).mockRejectedValueOnce(failure)
  await expect(call(value)).rejects.toBe(failure)
  await expect(restoreUndispatchedPublish(value.draft, value.attempt, failure)).rejects.toThrow('证明')
  const payload = JSON.parse(jest.mocked(integrationJson).mock.calls[0][1]!.body as string)
  expect(payload).toMatchObject({ note_key: 'publish:note', source_mode: 'local_snapshot', content: '保存正文', operation_id: 'operation' })
  expect(payload).not.toHaveProperty('version_id'); expect(payload).not.toHaveProperty('revision_id')
  expect((await readPublishDraft('owner', 'note'))?.state).toBe('unknown')
})
test('cross-operation and ABA owner transition cannot consume a proof', async () => {
  const value = await begin(); let failure: unknown
  try { await call(value) } catch (error) { failure = error }
  await expect(restoreUndispatchedPublish({ ...value.draft, operationId: 'other' }, value.attempt, failure)).rejects.toThrow()
  const epoch = identityEpoch(); transitionIdentity('other'); transitionIdentity('owner'); expect(identityEpoch()).not.toBe(epoch)
  await expect(restoreUndispatchedPublish(value.draft, value.attempt, failure)).rejects.toThrow()
})
test('attempt cannot be dispatched twice', async () => {
  const value = await begin()
  await expect(call(value)).rejects.toBeInstanceOf(FeishuPreflightError)
  await expect(call(value)).rejects.toThrow('attempt')
  expect(integrationJson).not.toHaveBeenCalled()
})
test('legacy frozen publication key stays absent and cannot be changed', async () => {
  const draft = newPublishDraft('owner', 'note', { title: 'old', content: 'old' }, {})
  delete draft.publicationKey
  await persistPublishDraft({ ...draft, state: 'unknown' })
  await expect(persistPublishDraft({ ...draft, state: 'unknown', publicationKey: 'publish:note' })).rejects.toThrow('来源已冻结')
  expect((await readPublishDraft('owner', 'note'))?.publicationKey).toBeUndefined()
})

test('recipient access binds the new draft fingerprint and payload; legacy unknown is not migrated', async () => {
  const options = { groups: ['oc_group'], notify_self: false }
  const next = newPublishDraft('owner', 'note', { title: 'saved', content: 'saved' }, options)
  expect(next.options.recipient_access_policy).toBe('grant_view_and_notify')
  expect(publishOptionsSignature(next.options)).not.toBe(publishOptionsSignature(options))
  expect(feishuPublishBody(next.publicationKey!, 'saved', 'saved', false, next.options)).toMatchObject({ recipient_access_policy: 'grant_view_and_notify', source_mode: 'local_snapshot' })
  expect(newSnapshotPublishOptions({ notify_self: true, recipient_access_policy: 'grant_view_and_notify', groups: [] })).not.toHaveProperty('recipient_access_policy')
  delete next.publicationKey; delete next.options.recipient_access_policy
  await persistPublishDraft({ ...next, state: 'unknown' })
  const original = await readPublishDraft('owner', 'note')
  expect(original?.options).toEqual(options)
  await expect(persistPublishDraft({ ...original!, options: { ...original!.options, recipient_access_policy: 'grant_view_and_notify' } })).rejects.toThrow()
  expect(await readPublishDraft('owner', 'note')).toEqual(original)
})
