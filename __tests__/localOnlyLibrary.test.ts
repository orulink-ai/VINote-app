import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import Share from 'react-native-share'
import { detachWorkspace, localLibrary } from '../src/lib/localLibrary'
import { createTextNote, getNote, listNotes, editNoteContent, noteRevisions, deleteNote, listDeletedNotes, setNoteDeleted, exportNoteFile, shareNoteFile } from '../src/lib/notes'
import { syncWorkspace, requestWorkspaceSync } from '../src/lib/workspace'
import { prepareWorkspaceMarkdown } from '../src/lib/workspaceAttachments'
import { integrationJson } from '../src/lib/integration'
import { readAccountId } from '../src/lib/storage'
import type { WorkspaceNote, WorkspaceState } from '../src/lib/workspaceStorage'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(), sessionRevision: () => 0 }))
let account: string, files: Map<string, string>
const row: WorkspaceNote = { key: 'stable', title: 'Saved', content: 'baseline', source_type: 'text', source_device: 'desktop', revision: 4, created_at: '2026-10-11', updated_at: '2026-10-12', deleted: false, archived: false, metadata: {}, transcript: null, versions: [{ id: 'v1', title: 'Original', content: 'original', created_at: '2026-10-11', kind: 'generated' }], version_count: 1, next_versions_offset: null }
const fixture = (): WorkspaceState => ({ serviceOrigin: 'https://old-service.example', cache: { stable: row }, mappings: { original: { group: 'original', key: 'stable', localIds: [], signature: '', revision: 4, status: 'conflict', conflict: { ...row, content: 'conflicting remote', revision: 5 }, pending: { signature: 'draft', body: { operation_id: 'unknown-original', base_revision: 4, title: 'Saved', content: 'latest draft', source_type: 'text', source_device: 'phone', versions: [] }, remaining: [{ id: 'remaining', title: 'Old edit', content: 'remaining edit', created_at: '2026-10-10' }] } } } })

beforeEach(async () => {
  jest.clearAllMocks(); account = 'A'; files = new Map()
  jest.mocked(readAccountId).mockImplementation(async () => account)
  jest.mocked(FS.exists).mockImplementation(async path => files.has(path))
  jest.mocked(FS.readFile).mockImplementation(async path => files.get(path)!)
  jest.mocked(FS.writeFile).mockImplementation(async (path, data) => { files.set(path, String(data)) })
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  globalThis.fetch = jest.fn(() => { throw new Error('unexpected network') }) as never
})

test('pending draft, remaining history and conflicting body survive conversion without mutating the archived intent', () => {
  const source = fixture(), original = JSON.stringify(source), state = detachWorkspace(source)
  expect(JSON.stringify(source)).toBe(original)
  expect(state.cache.stable.content).toBe('latest draft')
  expect(state.cache.stable.versions.map(value => value.content)).toEqual(expect.arrayContaining(['original', 'baseline', 'latest draft', 'remaining edit', 'conflicting remote']))
  expect(state.mappings.original.pending?.body.operation_id).toBe('unknown-original')
  expect(state.localOnly).toBe(true)
})

test('archived cache remains readable across service configuration without any cloud request', async () => {
  await Storage.setItem('vinote:A:workspace', JSON.stringify(fixture()))
  const notes = await listNotes('A')
  expect(notes).toHaveLength(1); expect(notes[0].id).toBe('workspace-stable')
  expect((await getNote(notes[0].id)).content).toBe('latest draft')
  expect(files.get('/documents/local-library-legacy-A.json')).toBe(JSON.stringify(fixture()))
  await syncWorkspace(); requestWorkspaceSync()
  expect(fetch).not.toHaveBeenCalled()
})

test('edit, trash and restore retain stable identity, all versions and original media', async () => {
  await Storage.setItem('vinote:A:workspace', JSON.stringify(fixture()))
  const source = await getNote('workspace-stable')
  const saved = await editNoteContent(source.id, 'edited', source, 'A')
  expect(saved.id).toBe(source.id); expect(saved.content_id).toBe('stable')
  await deleteNote(source.id)
  expect(await listNotes()).toEqual([])
  expect((await listDeletedNotes()).map(note => note.id)).toContain(source.id)
  expect((await noteRevisions(source.id)).map(note => note.content)).toContain('latest draft')
  await setNoteDeleted(source.id, false, 'A')
  expect((await getNote(source.id)).content).toBe('edited')
  expect((await localLibrary('A')).cache.stable.versions.map(value => value.content)).toContain('remaining edit')
  expect(jest.mocked(FS.unlink).mock.calls.every(([path]) => path.includes('workspace-'))).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

test('fresh edits reject an obsolete body while keeping history and the draft intent', async () => {
  const note = await createTextNote('Text', 'initial', 'stable-local')
  await editNoteContent(note.id, 'new body', note, 'A')
  await expect(editNoteContent(note.id, 'old draft', note, 'A')).rejects.toThrow('新修订')
  expect((await getNote(note.id)).content).toBe('new body')
  expect(fetch).not.toHaveBeenCalled()
})

test('a switch during legacy read cannot create a new owner snapshot or expose that owner data', async () => {
  const original = jest.mocked(Storage.getItem).getMockImplementation()!
  await Storage.setItem('vinote:A:workspace', JSON.stringify(fixture()))
  jest.mocked(Storage.getItem).mockImplementationOnce(async key => { const value = await original(key); account = 'B'; return value })
  await expect(localLibrary('A')).rejects.toThrow('账号已切换')
  expect(await Storage.getItem('vinote:B:workspace-file')).toBeNull()
  expect(FS.writeFile).not.toHaveBeenCalled()
})

test('archive failure leaves the old snapshot and unknown operation intact', async () => {
  await Storage.setItem('vinote:A:workspace', JSON.stringify(fixture()))
  jest.mocked(FS.writeFile).mockRejectedValueOnce(new Error('disk full'))
  await expect(localLibrary('A')).rejects.toThrow('disk full')
  expect(await Storage.getItem('vinote:A:workspace-file')).toBeNull()
  expect(JSON.parse((await Storage.getItem('vinote:A:workspace'))!).mappings.original.pending.body.operation_id).toBe('unknown-original')
})

test('a mapping with no retained body does not fabricate a note', () => {
  const state = fixture(); state.cache = {}; delete state.mappings.original.pending
  expect(detachWorkspace(state).cache).toEqual({})
})

test('an acknowledged deleted cache cannot be resurrected by an old unknown write', () => {
  const state = fixture(); state.cache.stable = { ...row, deleted: true }
  expect(detachWorkspace(state).cache.stable.deleted).toBe(true)
  expect(detachWorkspace(state).cache.stable.versions.map(version => version.content)).toContain('latest draft')
})

test('an acknowledged tombstone also hides a linked unsent device draft until explicit restore', async () => {
  const state = fixture(); state.cache.stable = { ...row, deleted: true }
  state.mappings.original.localIds = ['linked-original']
  await Storage.setItem('vinote:A:workspace', JSON.stringify(state))
  await Storage.setItem('vinote:A:note:linked-original', JSON.stringify({ id: 'linked-original', workspace_key: 'stable',
    content_id: 'stable', title: 'Device draft', content: 'unsent device draft', status: 'done', created_at: row.created_at, updated_at: row.updated_at }))
  expect(await listNotes('A')).toEqual([])
  expect(await getNote('linked-original')).toMatchObject({ deleted: true, content: 'unsent device draft' })
  await setNoteDeleted('linked-original', false, 'A')
  expect((await getNote('linked-original')).content).toBe('unsent device draft')
  expect((await listNotes('A')).map(note => note.id)).toContain('linked-original')
  expect(fetch).not.toHaveBeenCalled()
})

test('export and sharing use the saved Markdown with distinct system actions', async () => {
  const note = await createTextNote('Document', '# saved', 'export-id')
  await exportNoteFile(note); await shareNoteFile(note)
  expect(Share.open).toHaveBeenNthCalledWith(1, expect.objectContaining({ saveToFiles: true, type: 'text/markdown' }))
  expect(Share.open).toHaveBeenNthCalledWith(2, expect.objectContaining({ saveToFiles: false, type: 'text/markdown' }))
  expect(FS.writeFile).toHaveBeenCalledWith(expect.any(String), '# saved', 'utf8')
})

test('the integration boundary blocks all workspace verbs and automatic image upload before credentials or network', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) await expect(integrationJson('/api/workspace/notes/stable', { method })).rejects.toMatchObject({ code: 'WORKSPACE_REMOVED' })
  const markdown = '![saved](http://127.0.0.1:8900/api/task/old/artifacts/image.png)'
  expect(await prepareWorkspaceMarkdown(markdown, 'A')).toBe(markdown)
  expect(fetch).not.toHaveBeenCalled(); expect(FS.copyFile).not.toHaveBeenCalled()
})
