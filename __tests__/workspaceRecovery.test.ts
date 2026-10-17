import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { integrationJson } from '../src/lib/integration'
import { getNote, listDeletedNotes } from '../src/lib/notes'
import { readWorkspace, type WorkspaceState } from '../src/lib/workspaceStorage'
import { fetchWorkspaceNote, setWorkspaceDeleted, syncWorkspace, resolveWorkspaceConflict, queryWorkspaceOperation } from '../src/lib/workspace'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner'), sessionRevision: () => 0 }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', integrationJson: jest.fn() }))

const fixture = (): WorkspaceState => ({
  serviceOrigin: 'https://old.example',
  cache: { retained: { key: 'retained', title: 'Saved', content: 'acknowledged body', source_type: 'text', source_device: 'device',
    revision: 4, created_at: '2026-10-11', updated_at: '2026-10-12', deleted: false, archived: false,
    metadata: {}, transcript: null, versions: [], version_count: 0, next_versions_offset: null } },
  mappings: { original: { group: 'original', key: 'retained', localIds: [], signature: '', revision: 4, status: 'conflict',
    conflict: { key: 'retained', title: 'Saved', content: 'conflicting saved body', source_type: 'text', source_device: 'device',
      revision: 5, created_at: '2026-10-11', updated_at: '2026-10-12', deleted: false, archived: false,
      metadata: {}, transcript: null, versions: [], version_count: 0, next_versions_offset: null },
    pending: { signature: 'draft', dispatched: true, body: { operation_id: 'old-unknown', base_revision: 4,
      title: 'Saved', content: 'retained draft', source_type: 'text', source_device: 'phone', versions: [] } } } },
})
let files: Map<string, string>
beforeEach(async () => {
  jest.clearAllMocks(); files = new Map()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.mocked(FS.exists).mockImplementation(async path => files.has(path))
  jest.mocked(FS.readFile).mockImplementation(async path => files.get(path)!)
  jest.mocked(FS.writeFile).mockImplementation(async (path, body) => { files.set(path, String(body)) })
  jest.mocked(integrationJson).mockRejectedValue(new Error('workspace network must stay removed'))
  await Storage.setItem('vinote:owner:workspace', JSON.stringify(fixture()))
})
afterEach(() => expect(integrationJson).not.toHaveBeenCalled())

test('compatibility recovery reads retained draft and history instead of fetching a remote revision', async () => {
  await syncWorkspace()
  const row = await fetchWorkspaceNote('retained', 'owner')
  expect(row.content).toBe('retained draft')
  expect(row.versions.map(value => value.content)).toEqual(expect.arrayContaining(['acknowledged body', 'conflicting saved body', 'retained draft']))
  expect((await readWorkspace('owner')).mappings.original.pending?.body.operation_id).toBe('old-unknown')
  expect(files.get('/documents/local-library-legacy-owner.json')).toBe(JSON.stringify(fixture()))
})

test('an archived unknown receipt is neither queried nor replayed during recovery', async () => {
  await expect(queryWorkspaceOperation('retained', 'old-unknown', 'owner')).rejects.toThrow('跨设备同步已取消')
  await syncWorkspace()
  expect((await readWorkspace('owner')).mappings.original.pending?.dispatched).toBe(true)
  expect((await getNote('workspace-retained')).content).toBe('retained draft')
})

test('missing retained body is unavailable rather than replaced by a remote read', async () => {
  await expect(fetchWorkspaceNote('not-cached', 'owner')).rejects.toThrow('尚未保存在设备中')
  expect((await getNote('workspace-retained')).content).toBe('retained draft')
})

test('legacy deletion and restore affect device trash while preserving the old unknown intent', async () => {
  await setWorkspaceDeleted('retained', true)
  expect((await listDeletedNotes()).map(note => note.id)).toContain('workspace-retained')
  await setWorkspaceDeleted('retained', false)
  expect((await getNote('workspace-retained')).content).toBe('retained draft')
  expect((await readWorkspace('owner')).mappings.original.pending?.body.operation_id).toBe('old-unknown')
})

test('legacy conflict confirmation saves a device edit and preserves prior bodies without a remote PUT', async () => {
  await resolveWorkspaceConflict('original', 'explicit device edit', 5, 'owner', 'old-unknown')
  const note = await getNote('workspace-retained')
  expect(note.content).toBe('explicit device edit')
  expect((await readWorkspace('owner')).cache.retained.versions.map(value => value.content)).toContain('retained draft')
})

test.each([[4, 'old-unknown'], [5, 'different-operation']] as const)('stale comparison %s / %s cannot replace the retained draft', async (revision, operation) => {
  await expect(resolveWorkspaceConflict('original', 'unsafe edit', revision, 'owner', operation)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT_CHANGED' })
  expect((await getNote('workspace-retained')).content).toBe('retained draft')
})

test('another owner cannot read or migrate this device snapshot through the compatibility API', async () => {
  await expect(fetchWorkspaceNote('retained', 'other-owner')).rejects.toThrow('账号已切换')
  expect(FS.writeFile).not.toHaveBeenCalled()
})

test('archive write failure preserves the old snapshot and unknown operation without network recovery', async () => {
  jest.mocked(FS.writeFile).mockRejectedValueOnce(new Error('disk full'))
  await expect(syncWorkspace()).rejects.toThrow('disk full')
  expect(await Storage.getItem('vinote:owner:workspace-file')).toBeNull()
  expect(await Storage.getItem('vinote:owner:workspace')).toBe(JSON.stringify(fixture()))
})
