import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { editNoteContent, getNote, listNotes } from '../src/lib/notes'
import { readAccountId, sessionRevision } from '../src/lib/storage'
import * as integration from '../src/lib/integration'
import * as environment from '../src/config/env'
import { readWorkspace, writeWorkspace, type WorkspaceState } from '../src/lib/workspaceStorage'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(), sessionRevision: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ requestWorkspaceSync: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ __esModule: true, integrationBaseUrl: 'https://workspace.example', operationId: jest.fn() }))
jest.mock('../src/config/env', () => ({ __esModule: true, AUTH_BASE_URL: 'https://auth.example' }))

const originalGet = jest.mocked(Storage.getItem).getMockImplementation()!
const originalSet = jest.mocked(Storage.setItem).getMockImplementation()!
const key = (owner = 'alice', id = 'local') => `vinote:${owner}:note:${id}`
const pointerKey = (owner = 'alice') => `vinote:${owner}:workspace-file`
const local: Note = { id: 'local', title: 'Local', content: 'local original', status: 'done',
  created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', workspace_revision: 4 }
const state = (content = 'remote original', revision = 5): WorkspaceState => ({
  localOnly: true, serviceOrigin: 'https://workspace.example', mappings: { local: { key: 'shared', group: 'note:local',
    localIds: ['local'], signature: 'ack', revision, status: 'synced' } },
  cache: { shared: { key: 'shared', title: 'Remote', content, revision, source_type: 'text', source_device: 'desktop',
    created_at: local.created_at, updated_at: '2026-10-12T01:00:00Z', deleted: false, archived: false,
    metadata: {}, transcript: { full_text: 'evidence', aliases: { speaker: 'Original' } },
    versions: [], version_count: 0, next_versions_offset: null } },
})
let account: string | null = 'alice', generation = 0
let files: Map<string, string>
let token = 0
async function commit(snapshot: WorkspaceState, owner = 'alice') {
  const file = `${++token}-abcd`
  files.set(`/documents/workspace-${owner}-${file}.json`, JSON.stringify(snapshot))
  await originalSet(pointerKey(owner), JSON.stringify({ file }))
}
const display = (id = 'workspace-shared', expectedOwner = 'alice') => getNote(id, { expectedOwner, mode: 'display' })

beforeEach(async () => {
  jest.mocked(Storage.getItem).mockImplementation(originalGet)
  jest.mocked(Storage.setItem).mockImplementation(originalSet)
  for (const name of await Storage.getAllKeys()) await Storage.removeItem(name)
  account = 'alice'; generation++; files = new Map()
  Object.assign(integration, { integrationBaseUrl: 'https://workspace.example' })
  Object.assign(environment, { AUTH_BASE_URL: 'https://auth.example' })
  jest.mocked(readAccountId).mockImplementation(async () => account)
  jest.mocked(sessionRevision).mockImplementation(() => generation)
  jest.mocked(FS.readFile).mockImplementation(async path => {
    if (!files.has(path)) throw new Error('missing snapshot')
    return files.get(path)!
  })
  jest.mocked(FS.writeFile).mockImplementation(async (path, body) => { files.set(path, body); return undefined as never })
  for (const owner of ['alice', 'bob']) { await originalSet(key(owner), JSON.stringify(local)); await commit(state(`${owner} remote`), owner) }
  jest.clearAllMocks()
})

test('explicit owner mismatch rejects before reading either account namespace', async () => {
  account = 'bob'; generation++
  await expect(display()).rejects.toThrow('账号已切换')
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
})

test('switch during local read never mixes A local body with B workspace', async () => {
  jest.mocked(Storage.getItem).mockImplementation(async name => {
    const value = await originalGet(name)
    if (name === key()) { account = 'bob'; generation++ }
    return value
  })
  await expect(getNote('local')).rejects.toThrow('账号已切换')
  expect(jest.mocked(Storage.getItem).mock.calls.every(([name]) => name.startsWith('vinote:alice:'))).toBe(true)
})

test.each(['account-return', 'token-refresh', 'auth-origin', 'workspace-origin'])('%s during file read discards the late body without warming display', async boundary => {
  const read = jest.mocked(FS.readFile).getMockImplementation()!
  jest.mocked(FS.readFile).mockImplementationOnce(async path => {
    const body = await read(path)
    if (boundary === 'account-return') { account = 'bob'; generation++; account = 'alice'; generation++ }
    if (boundary === 'token-refresh') generation++
    if (boundary === 'auth-origin') Object.assign(environment, { AUTH_BASE_URL: 'https://other-auth.example' })
    if (boundary === 'workspace-origin') Object.assign(integration, { integrationBaseUrl: 'https://other-workspace.example' })
    return body
  })
  await expect(display()).rejects.toThrow(/账号已切换|会话|服务/)
  Object.assign(environment, { AUTH_BASE_URL: 'https://auth.example' })
  Object.assign(integration, { integrationBaseUrl: 'https://workspace.example' })
  await display()
  expect(FS.readFile).toHaveBeenCalledTimes(2)
})

test('display reopens avoid file reads, while default getNote and readWorkspace remain fresh', async () => {
  const first = await display()
  expect(await display()).toEqual(first)
  expect(FS.readFile).toHaveBeenCalledTimes(1)
  expect(jest.mocked(Storage.getItem).mock.calls.filter(([name]) => name === key('alice', 'workspace-shared')).length).toBeGreaterThanOrEqual(2)
  expect(jest.mocked(Storage.getItem).mock.calls.filter(([name]) => name === pointerKey()).length).toBeGreaterThanOrEqual(2)
  await getNote('local'); await readWorkspace('alice')
  expect(FS.readFile).toHaveBeenCalledTimes(3)
})

test('list warms its virtual detail projection without reusing list snapshots for subsequent lists', async () => {
  const rows = await listNotes('alice')
  const filesBefore = jest.mocked(FS.readFile).mock.calls.length
  expect(await display(rows[0].id)).toEqual(rows[0])
  expect(FS.readFile).toHaveBeenCalledTimes(filesBefore)
  await listNotes('alice')
  expect(jest.mocked(FS.readFile).mock.calls.length).toBeGreaterThan(filesBefore)
})

test('committed pointer changes invalidate display even with the same note id', async () => {
  await display(); await commit(state('new acknowledged body', 6))
  expect(await display()).toMatchObject({ content: 'new acknowledged body', workspace_revision: 6 })
  expect(FS.readFile).toHaveBeenCalledTimes(2)
})

test('local value changes invalidate display even with unchanged timestamp and pointer', async () => {
  await display('local')
  await originalSet(key(), JSON.stringify({ ...local, updated_at: '2026-10-12T02:00:00Z', content: 'dirty A' }))
  expect((await display('local')).content).toBe('dirty A')
  await originalSet(key(), JSON.stringify({ ...local, updated_at: '2026-10-12T02:00:00Z', content: 'dirty B' }))
  expect((await display('local')).content).toBe('dirty B')
  expect(FS.readFile).toHaveBeenCalledTimes(3)
})

test('returned list and detail objects cannot mutate cached nested tags or transcript', async () => {
  await Storage.removeItem(key())
  const snapshot = state(); snapshot.cache.shared.metadata.tags = ['original']
  await commit(snapshot)
  const rows = await listNotes('alice')
  const readsBeforeMutation = jest.mocked(FS.readFile).mock.calls.length
  rows[0].tags!.push('list mutation'); rows[0].transcript!.aliases!.speaker = 'List mutation'
  const first = await display(rows[0].id)
  expect(first.tags).toEqual(['original']); expect(first.transcript!.aliases!.speaker).toBe('Original')
  first.tags!.push('detail mutation'); first.transcript!.aliases!.speaker = 'Detail mutation'
  expect((await display(rows[0].id)).tags).toEqual(['original'])
  expect((await display(rows[0].id)).transcript!.aliases!.speaker).toBe('Original')
  expect(FS.readFile).toHaveBeenCalledTimes(readsBeforeMutation)
})

test.each([{ status: 'pending' as const }, { status: 'conflict' as const }])('$status preserves the local draft and expected revision on cold and warm reads', async ({ status }) => {
  const snapshot = state('remote conflict', 9)
  snapshot.mappings.local.status = status
  if (status === 'pending') snapshot.mappings.local.pending = { signature: 'dirty', body: {
    base_revision: 4, operation_id: 'original-operation', title: local.title, content: local.content,
    source_type: 'text', source_device: 'mobile', versions: [] } }
  else snapshot.mappings.local.conflict = snapshot.cache.shared
  await commit(snapshot)
  expect(await display('local')).toEqual(local); expect(await display('local')).toEqual(local)
  expect(FS.readFile).toHaveBeenCalledTimes(1)
})

test('a display hit cannot satisfy an editor CAS read of a newer committed revision', async () => {
  const baseline = await display()
  await commit(state('newer remote', 6))
  await expect(editNoteContent('workspace-shared', 'draft', baseline, 'alice')).rejects.toThrow('正文已有新修订')
  expect(Storage.setItem).not.toHaveBeenCalled()
  expect(FS.readFile).toHaveBeenCalledTimes(2)
})

test('device-owned content from a former service remains readable without rebinding its original service', async () => {
  const snapshot = state('old service content'); snapshot.serviceOrigin = 'https://old.example'
  await commit(snapshot)
  expect(await display('local')).toEqual(local)
  expect(await getNote('local')).toEqual(local)
  expect((await display('workspace-shared')).content).toBe(snapshot.cache.shared.content)
  expect(await listNotes('alice')).toEqual([local])
  expect((await readWorkspace('alice')).cache.shared.content).toBe('old service content')
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test('retained device-owned legacy content stays readable without inventing service provenance', async () => {
  const snapshot = state('unbound legacy content'); delete snapshot.serviceOrigin
  await commit(snapshot)
  expect(await display('local')).toEqual(local)
  expect((await display('workspace-shared')).content).toBe(snapshot.cache.shared.content)
  expect(await listNotes('alice')).toEqual([local])
  expect((await readWorkspace('alice')).cache.shared.content).toBe('unbound legacy content')
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test.each(['missing', 'different'])('an old %s Origin cannot make retained device content disappear', async provenance => {
  const snapshot = state('retained old body')
  if (provenance === 'missing') delete snapshot.serviceOrigin
  else snapshot.serviceOrigin = 'https://old.example'
  await commit(snapshot); await Storage.removeItem(key())
  expect((await listNotes('alice'))[0].content).toBe('retained old body')
  expect((await getNote('local')).content).toBe('retained old body')
  expect((await readWorkspace('alice')).cache.shared.content).toBe('retained old body')
  expect(Storage.setItem).not.toHaveBeenCalled()
})

test('switching scope after a warm hit cannot reuse the old owner, session or origin projection', async () => {
  await display()
  account = 'bob'; generation++
  expect((await display('workspace-shared', 'bob')).content).toBe('bob remote')
  account = 'alice'; generation++
  expect((await display()).content).toBe('alice remote')
  expect(FS.readFile).toHaveBeenCalledTimes(3)
})

test('a pointer changed during file read is re-read and the older result is never warmed', async () => {
  const read = jest.mocked(FS.readFile).getMockImplementation()!
  jest.mocked(FS.readFile).mockImplementationOnce(async path => {
    const body = await read(path); await commit(state('raced newest', 6)); return body
  })
  expect((await display()).content).toBe('raced newest')
  const reads = jest.mocked(FS.readFile).mock.calls.length
  expect((await display()).content).toBe('raced newest')
  expect(FS.readFile).toHaveBeenCalledTimes(reads)
})

test('writeWorkspace pointer commit invalidates warmed display', async () => {
  await display(); await writeWorkspace('alice', state('written snapshot', 6))
  expect((await display()).content).toBe('written snapshot')
  expect(FS.readFile).toHaveBeenCalledTimes(2)
})

test('LRU holds at most sixteen note projections', async () => {
  const snapshot = state(); snapshot.cache = {}; snapshot.mappings = {}
  for (let index = 0; index < 17; index++) snapshot.cache[`n${index}`] = { ...state().cache.shared, key: `n${index}` }
  await commit(snapshot)
  for (let index = 0; index < 16; index++) await display(`workspace-n${index}`)
  await display('workspace-n0') // promote oldest before inserting the seventeenth
  await display('workspace-n16')
  const reads = jest.mocked(FS.readFile).mock.calls.length
  await display('workspace-n0'); expect(FS.readFile).toHaveBeenCalledTimes(reads)
  await display('workspace-n1'); expect(FS.readFile).toHaveBeenCalledTimes(reads + 1)
})

test('oversized projections never remain in the four MiB display cache', async () => {
  await commit(state('x'.repeat(3 * 1024 * 1024)))
  await display(); await display()
  expect(FS.readFile).toHaveBeenCalledTimes(2)
})

test('aggregate budget evicts old projections even below the sixteen-entry limit', async () => {
  const snapshot = state(); snapshot.cache = {}; snapshot.mappings = {}
  for (let index = 0; index < 3; index++) snapshot.cache[`n${index}`] = { ...state().cache.shared, key: `n${index}`, content: 'x'.repeat(900000) }
  await commit(snapshot)
  for (let index = 0; index < 3; index++) await display(`workspace-n${index}`)
  const reads = jest.mocked(FS.readFile).mock.calls.length
  await display('workspace-n2'); expect(FS.readFile).toHaveBeenCalledTimes(reads)
  await display('workspace-n0'); expect(FS.readFile).toHaveBeenCalledTimes(reads + 1)
})

test('legacy snapshots without an immutable pointer are always read afresh', async () => {
  await Storage.removeItem(pointerKey())
  await originalSet('vinote:alice:workspace', JSON.stringify(state('legacy A')))
  expect((await display()).content).toBe('legacy A')
  await originalSet('vinote:alice:workspace', JSON.stringify(state('legacy B')))
  expect((await display()).content).toBe('legacy B')
})

test('unreadable new pointer never falls back to a previously warmed body', async () => {
  await display(); await originalSet(pointerKey(), JSON.stringify({ file: '999-abcd' }))
  await expect(display()).rejects.toThrow('missing snapshot')
})

test('local edit during the slow native read is resolved again before warming its projection', async () => {
  const read = jest.mocked(FS.readFile).getMockImplementation()!
  jest.mocked(FS.readFile).mockImplementationOnce(async path => {
    const body = await read(path)
    await originalSet(key(), JSON.stringify({ ...local, content: 'edited during read', updated_at: '2026-10-12T02:00:00Z' }))
    return body
  })
  expect((await display('local')).content).toBe('edited during read')
  const reads = jest.mocked(FS.readFile).mock.calls.length
  expect((await display('local')).content).toBe('edited during read')
  expect(FS.readFile).toHaveBeenCalledTimes(reads)
})

test('a late old owner cannot refill or evict the new owner warm cache', async () => {
  let release!: () => void, started!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  const read = jest.mocked(FS.readFile).getMockImplementation()!
  jest.mocked(FS.readFile).mockImplementationOnce(async path => { const body = await read(path); started(); await wait; return body })
  const late = display()
  const rejected = expect(late).rejects.toThrow('账号已切换')
  await entered
  try {
    account = 'bob'; generation++
    expect((await display('workspace-shared', 'bob')).content).toBe('bob remote')
  } finally { release() }
  await rejected
  const reads = jest.mocked(FS.readFile).mock.calls.length
  expect((await display('workspace-shared', 'bob')).content).toBe('bob remote')
  expect(FS.readFile).toHaveBeenCalledTimes(reads)
})
