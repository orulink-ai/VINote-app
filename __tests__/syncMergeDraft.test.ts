import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readAccountId } from '../src/lib/storage'
import { mergeDraftFor, mergeDraftMatches, readMergeDraft, removeMergeDraft, saveMergeDraft } from '../src/lib/syncMergeDraft'
import type { WorkspaceMapping, WorkspaceNote } from '../src/lib/workspaceStorage'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner-a') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://owned.example' }))
const mapping = {
  key: 'key-a', group: 'note:a', localIds: ['a'], revision: 1, signature: '', status: 'conflict',
  pending: { signature: '', body: { operation_id: 'operation-a', base_revision: 1, title: '合成笔记', content: 'local', source_type: 'text', source_device: 'mobile', versions: [] } },
  conflict: { key: 'key-a', content: 'remote', revision: 3, deleted: false } as WorkspaceNote,
} satisfies WorkspaceMapping
const files = new Map<string, string>()
beforeEach(async () => {
  jest.clearAllMocks(); files.clear()
  jest.mocked(readAccountId).mockReset().mockResolvedValue('owner-a')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.mocked(FS.writeFile).mockImplementation(async (file, text) => { files.set(file, text) })
  jest.mocked(FS.readFile).mockImplementation(async file => { const text = files.get(file); if (text === undefined) throw new Error('missing file'); return text })
  jest.mocked(FS.unlink).mockImplementation(async file => { files.delete(file) })
})

test('full merge text goes into a file; only a small pointer enters SQLite and the same operation restores it', async () => {
  const draft = { ...mergeDraftFor('owner-a', mapping), text: '长正文'.repeat(50000) }
  await saveMergeDraft(draft)
  const calls = jest.mocked(Storage.setItem).mock.calls
  expect(calls).toHaveLength(1)
  expect(calls[0][1].length).toBeLessThan(400)
  expect(await readMergeDraft('owner-a', 'operation-a')).toEqual(draft)
  expect(await readMergeDraft('owner-a', 'other-operation')).toBeNull()
})

test('closing after rapid edits retains the last text, and explicit discard removes only this operation', async () => {
  const initial = mergeDraftFor('owner-a', mapping)
  await Promise.all([saveMergeDraft({ ...initial, text: 'first' }), saveMergeDraft({ ...initial, text: 'last' })])
  await saveMergeDraft({ ...initial, operationId: 'other-operation', text: 'other' })
  expect((await readMergeDraft('owner-a', 'operation-a'))?.text).toBe('last')
  await removeMergeDraft('owner-a', 'operation-a')
  expect(await readMergeDraft('owner-a', 'operation-a')).toBeNull()
  expect((await readMergeDraft('owner-a', 'other-operation'))?.text).toBe('other')
})

test('same owner and operation are not sufficient when the compared revision or local input has changed', () => {
  const draft = mergeDraftFor('owner-a', mapping)
  expect(mergeDraftMatches(draft, mapping)).toBe(true)
  expect(mergeDraftMatches(draft, { ...mapping, conflict: { ...mapping.conflict, revision: 4 } })).toBe(false)
  expect(mergeDraftMatches(draft, { ...mapping, pending: { ...mapping.pending, body: { ...mapping.pending.body, content: 'different local' } } })).toBe(false)
  expect(mergeDraftMatches({ ...draft, serviceOrigin: 'https://other.example' }, mapping)).toBe(false)
})

test('unreadable draft is an error rather than an empty draft to overwrite', async () => {
  await saveMergeDraft(mergeDraftFor('owner-a', mapping))
  jest.mocked(FS.readFile).mockRejectedValueOnce(new Error('unreadable'))
  await expect(readMergeDraft('owner-a', 'operation-a')).rejects.toThrow('unreadable')
  expect(await readMergeDraft('owner-a', 'operation-a')).not.toBeNull()
})

test('an account switch during the file write cannot commit a pointer or load the other owner draft', async () => {
  jest.mocked(FS.writeFile).mockImplementationOnce(async () => { jest.mocked(readAccountId).mockResolvedValue('owner-b') })
  await expect(saveMergeDraft(mergeDraftFor('owner-a', mapping))).rejects.toThrow('账号已切换')
  expect(Storage.setItem).not.toHaveBeenCalled()
  await expect(readMergeDraft('owner-a', 'operation-a')).rejects.toThrow('账号已切换')
})
