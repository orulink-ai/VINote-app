import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { listLocalNotes, listNotes } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import { integrationJson } from '../src/lib/integration'
import { workspaceViews, type WorkspaceNote, type WorkspaceState } from '../src/lib/workspaceStorage'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ requestWorkspaceSync: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ operationId: jest.fn(), integrationJson: jest.fn(), integrationBaseUrl: 'https://workspace.example' }))

const originalGet = jest.mocked(Storage.getItem).getMockImplementation()!
const originalSet = jest.mocked(Storage.setItem).getMockImplementation()!
const originalKeys = jest.mocked(Storage.getAllKeys).getMockImplementation()!
const noteKey = (owner: string) => `vinote:${owner}:note:local-note`
const snapshotPath = (owner: string) => `/documents/workspace-${owner}-123-abcd.json`
const local: Note = { id: 'local-note', workspace_key: 'shared', title: 'Local title', content: 'local draft',
  workspace_revision: 4, status: 'done', created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
const remote = (content: string): WorkspaceNote => ({ key: 'shared', title: 'Cached title', content,
  source_type: 'text', source_device: 'desktop', revision: 5, created_at: local.created_at,
  updated_at: '2026-10-12T01:00:00Z', deleted: false, archived: false, version_count: 1,
  transcript: null, metadata: {}, versions: [], next_versions_offset: null })
const stateFor = (content: string): WorkspaceState => ({ localOnly: true, serviceOrigin: 'https://workspace.example', cache: { shared: remote(content) }, mappings: {
  'note:local-note': { key: 'shared', group: 'note:local-note', localIds: ['local-note'],
    signature: 'acknowledged', revision: 5, status: 'synced' } } })
let account: string | null
let snapshots: Map<string, WorkspaceState>

beforeEach(async () => {
  jest.mocked(Storage.getItem).mockImplementation(originalGet)
  jest.mocked(Storage.getAllKeys).mockImplementation(originalKeys)
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  account = 'alice'
  snapshots = new Map()
  jest.mocked(readAccountId).mockImplementation(async () => account)
  jest.mocked(FS.readFile).mockImplementation(async path => JSON.stringify(snapshots.get(path)))
  for (const owner of ['alice', 'bob']) {
    snapshots.set(snapshotPath(owner), stateFor(`${owner} cached content`))
    await originalSet(noteKey(owner), JSON.stringify(local))
    await originalSet(`vinote:${owner}:workspace-file`, JSON.stringify({ file: '123-abcd' }))
  }
  jest.clearAllMocks()
})

test('one load checks migration and merges only the fixed owner device namespace and fresh snapshot, without network or writes', async () => {
  const rows = await listNotes('alice')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ content: 'local draft', workspace_revision: 4 })
  expect(jest.mocked(FS.readFile).mock.calls.every(([path]) => path === snapshotPath('alice'))).toBe(true)
  expect(FS.readFile).toHaveBeenCalledWith(snapshotPath('alice'), 'utf8')
  expect(jest.mocked(Storage.getItem).mock.calls.every(([key]) => key.startsWith('vinote:alice:'))).toBe(true)
  expect(integrationJson).not.toHaveBeenCalled()
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test('an explicitly bound old owner is rejected before reading the new account', async () => {
  account = 'bob'
  await expect(listNotes('alice')).rejects.toThrow('账号已切换')
  expect(Storage.getAllKeys).not.toHaveBeenCalled()
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
})

test('switching account during key enumeration stops local reads before any row is returned', async () => {
  jest.mocked(Storage.getAllKeys).mockImplementation(async () => {
    const keys = await originalKeys()
    account = 'bob'
    return keys
  })
  await expect(listLocalNotes('alice')).rejects.toThrow('账号已切换')
  expect(Storage.getItem).not.toHaveBeenCalled()
})

test('switching account during local body reads rejects the merged list without reading B bodies', async () => {
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    const value = await originalGet(key)
    if (key === noteKey('alice')) account = 'bob'
    return value
  })
  await expect(listNotes('alice')).rejects.toThrow('账号已切换')
  expect(jest.mocked(Storage.getItem).mock.calls.every(([key]) => key.startsWith('vinote:alice:'))).toBe(true)
  expect(jest.mocked(FS.readFile).mock.calls.every(([path]) => path === snapshotPath('alice'))).toBe(true)
})

test('switching account during snapshot reads rejects the list even with identical note ids', async () => {
  jest.mocked(FS.readFile).mockImplementation(async path => {
    const body = JSON.stringify(snapshots.get(path))
    account = 'bob'
    return body
  })
  await expect(listNotes('alice')).rejects.toThrow('账号已切换')
  expect(FS.readFile).toHaveBeenCalledWith(snapshotPath('alice'), 'utf8')
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test('legacy list callers capture the owner at entry rather than mixing A notes with B cache', async () => {
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    const value = await originalGet(key)
    if (key === noteKey('alice')) account = 'bob'
    return value
  })
  await expect(listNotes()).rejects.toThrow('账号已切换')
  expect(jest.mocked(Storage.getItem).mock.calls.every(([key]) => key.startsWith('vinote:alice:'))).toBe(true)
})

test('local and workspace reads start independently rather than waiting for all local bodies', async () => {
  let release!: () => void, started!: () => void
  const stalled = new Promise<void>(resolve => { release = resolve })
  const localStarted = new Promise<void>(resolve => { started = resolve })
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    if (key === noteKey('alice')) { started(); await stalled }
    return originalGet(key)
  })
  const reading = listNotes('alice')
  try {
    await localStarted
    expect(FS.readFile).toHaveBeenCalledWith(snapshotPath('alice'), 'utf8')
  } finally { release() }
  expect((await reading)[0].content).toBe('local draft')
})

test('a caller-supplied per-load snapshot is reused by the view merge without a second read', async () => {
  const rows = await workspaceViews([local], stateFor('given snapshot'))
  expect(rows[0].content).toBe('local draft')
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
})

test('each new list load reads the newly committed snapshot, with no module cache or stale CAS revision', async () => {
  await Storage.removeItem(noteKey('alice'))
  expect((await listNotes('alice'))[0].workspace_revision).toBe(5)
  const priorReads = jest.mocked(FS.readFile).mock.calls.length
  const next = stateFor('newer acknowledged content')
  next.cache.shared.revision = 6
  snapshots.set(snapshotPath('alice'), next)
  expect((await listNotes('alice'))[0]).toMatchObject({ content: 'newer acknowledged content', workspace_revision: 6 })
  expect(jest.mocked(FS.readFile).mock.calls.length).toBeGreaterThan(priorReads)
})

test('background sync failure preserves readable cache and leaves failed/pending state untouched', async () => {
  const state = snapshots.get(snapshotPath('alice'))!
  state.error = 'cloud unavailable'
  state.syncing = false
  state.mappings['note:local-note'].status = 'failed'
  state.mappings['note:local-note'].pending = { signature: 'draft', body: { base_revision: 4,
    operation_id: 'original-operation', title: local.title, content: local.content,
    source_type: 'text', source_device: 'mobile', versions: [] } }
  const before = JSON.stringify(state)
  expect(await listNotes('alice')).toEqual([local])
  expect(JSON.stringify(state)).toBe(before)
  expect(integrationJson).not.toHaveBeenCalled()
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test('a known tombstone suppresses linked local content even when historical conflict metadata remains', async () => {
  const state = snapshots.get(snapshotPath('alice'))!
  state.cache.shared.deleted = true
  expect(await listNotes('alice')).toEqual([])
  state.mappings['note:local-note'].status = 'conflict'
  expect(await listNotes('alice')).toEqual([])
})

test('no logged-in owner returns no account data', async () => {
  account = null
  await expect(listNotes()).rejects.toMatchObject({ status: 401 })
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
})
