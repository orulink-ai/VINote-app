import Storage from '@react-native-async-storage/async-storage'
import { enqueueFeishuAutomatic, readFeishuAutomatic, persistAutomaticHandoff } from '../src/lib/feishuAutomaticQueue'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://test.example', operationId: jest.fn(() => 'operation-one') }))
beforeEach(async () => { transitionIdentity('owner'); for (const key of await Storage.getAllKeys()) await Storage.removeItem(key) })

test('concurrent handoffs retain one operation and the original snapshot', async () => {
  const note = { id: 'note-1', title: '会议', content: '正文' }
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'settings', consentId: 'id' }
  const options = { notify_self: true, groups: [] as string[] }
  await Promise.all([enqueueFeishuAutomatic('owner', note, consent, options), enqueueFeishuAutomatic('owner', note, consent, options)])
  expect(await readFeishuAutomatic('owner', note.id)).toMatchObject({ operationId: 'operation-one', note, state: 'prepared', consent, options })
})

test('a conflicting handoff cannot replace the original operation', async () => {
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'settings', consentId: 'id' }
  await enqueueFeishuAutomatic('owner', { id: 'note-1', title: '会议', content: '原文' }, consent, {})
  await expect(enqueueFeishuAutomatic('owner', { id: 'note-1', title: '会议', content: '新正文' }, consent, {})).rejects.toThrow()
  expect((await readFeishuAutomatic('owner', 'note-1'))?.note.content).toBe('原文')
})

test('recovery preserves the operation captured before the note was saved', async () => {
  const intent = { owner: 'owner', origin: 'https://test.example', operationId: 'frozen-operation',
    note: { id: 'note-2', title: '会议', content: '正文' },
    consent: { connectionBinding: 'binding', settingsFingerprint: 'settings', consentId: 'consent' }, options: {}, state: 'prepared' as const }
  await persistAutomaticHandoff(intent)
  await persistAutomaticHandoff(intent)
  expect((await readFeishuAutomatic('owner', 'note-2'))?.operationId).toBe('frozen-operation')
})
