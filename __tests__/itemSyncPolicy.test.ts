import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { getNote } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import { integrationJson, integrationBaseUrl, IntegrationError } from '../src/lib/integration'
import { readWorkspace, writeWorkspace, type WorkspaceNote, type WorkspaceState } from '../src/lib/workspaceStorage'
import { readItemSyncPolicy, setItemSyncPolicy } from '../src/lib/itemSyncPolicy'
import { queryWorkspaceOperation, syncWorkspace } from '../src/lib/workspace'
import { prepareWorkspaceMarkdown } from '../src/lib/workspaceAttachments'
import { beginVerification, finishVerification } from '../src/lib/sessionGate'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/workspaceAttachments', () => ({ prepareWorkspaceMarkdown: jest.fn(async (value: string) => value) }))
jest.mock('../src/lib/integration', () => ({
  integrationBaseUrl: 'https://shared.example', operationId: jest.fn(() => 'new-op'), integrationJson: jest.fn(),
  IntegrationError: class extends Error { constructor(message: string, status: number, code: string) { super(message); Object.assign(this, { status, code }) } },
}))
const local: Note = { id: 'local-one', content_id: 'canonical-one', title: 'Same title', content: 'device draft',
  status: 'done', created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
const remote: WorkspaceNote = { key: 'canonical-one', title: 'Same title', content: 'cloud text', source_type: 'text', source_device: 'Desktop',
  revision: 7, created_at: local.created_at, updated_at: local.updated_at, deleted: false, archived: false,
  transcript: null, metadata: {}, versions: [], version_count: 0, next_versions_offset: null }
const acknowledged = (): WorkspaceState => ({ serviceOrigin: integrationBaseUrl, cache: { [remote.key]: remote }, mappings: {
  'note:local-one': { key: remote.key, group: 'note:local-one', localIds: [local.id], signature: 'real-ack-signature', revision: 7, status: 'synced' },
} })
const originalSet = jest.mocked(Storage.setItem).getMockImplementation()!
let account: string, cloud: WorkspaceNote | undefined
beforeEach(async () => {
  jest.mocked(Storage.setItem).mockImplementation(originalSet)
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  account = 'A'; transitionIdentity(account); finishVerification(beginVerification(account), 'verified')
  jest.mocked(readAccountId).mockImplementation(async () => account)
  jest.mocked(listRecordings).mockResolvedValue([])
  const files = new Map<string, string>()
  jest.mocked(FS.writeFile).mockImplementation(async (path, value) => { files.set(path, value); return undefined as never })
  jest.mocked(FS.readFile).mockImplementation(async path => files.get(path)!)
  jest.mocked(FS.unlink).mockImplementation(async path => { files.delete(path) })
  cloud = undefined
  await Storage.setItem('vinote:A:note:local-one', JSON.stringify(local))
  await writeWorkspace('A', { mappings: {}, cache: {} })
  jest.clearAllMocks()
  jest.mocked(integrationJson).mockImplementation(async (path, init = {}, _owner, _timeout, guard) => {
    guard?.()
    if (path.endsWith('/status')) return { mode: 'shared', capabilities: { item_sync_policy: 1, operation_receipts: 1 } } as never
    if (path.includes('/operations/')) return { operation_id: 'old-op', note_key: remote.key, acknowledged_revision: 8, status: 'acknowledged' } as never
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string)
      cloud = { ...remote, ...body, key: remote.key, revision: body.base_revision + 1 }
      return cloud as never
    }
    if (!cloud) throw new IntegrationError('not found', 404, 'NOT_FOUND')
    return JSON.parse(JSON.stringify(cloud)) as never
  })
})
const mutations = () => jest.mocked(integrationJson).mock.calls.filter(([, init]) => init?.method)

test('a new local object remains local: no cloud scan, mapping, pending, or attachment upload', async () => {
  expect(await readItemSyncPolicy(local, 'A')).toMatchObject({ mode: 'local-only', authorization: 'none', contentId: 'canonical-one' })
  await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled(); expect(prepareWorkspaceMarkdown).not.toHaveBeenCalled()
  expect((await readWorkspace('A')).mappings).toEqual({})
  expect((await getNote(local.id)).content).toBe(local.content)
})

test('a retained explicit sync choice is metadata only after cancellation and cannot upload originals', async () => {
  await setItemSyncPolicy(local.id, 'sync', 'A'); await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  expect(prepareWorkspaceMarkdown).not.toHaveBeenCalled()
  expect((await getNote(local.id)).content).toBe(local.content)
  expect(await readItemSyncPolicy(local.id, 'A')).toMatchObject({ contentId: 'canonical-one', mode: 'sync' })
})

test('legacy sync preference leaves the current-device recording association readable without creating a cloud row', async () => {
  await Storage.setItem('vinote:A:note:local-one', JSON.stringify({ ...local, task_id: 'real-local-recording', source_type: 'meeting_recording' }))
  jest.mocked(listRecordings).mockResolvedValue([{ id: 'real-local-recording', title: 'recording', uri: 'file:///device-only.m4a', duration: 4690, createdAt: local.created_at }])
  await setItemSyncPolicy(local.id, 'sync', 'A'); await syncWorkspace()
  expect((await getNote(local.id)).task_id).toBe('real-local-recording')
  await expect(getNote(`workspace-${local.content_id}`)).rejects.toMatchObject({ status: 404 })
  expect(JSON.stringify(mutations())).not.toContain('file:///device-only.m4a')
})

test('a same-named distinct canonical content is not silently merged or uploaded by another item grant', async () => {
  await Storage.setItem('vinote:A:note:local-two', JSON.stringify({ ...local, id: 'local-two', content_id: 'canonical-two' }))
  await setItemSyncPolicy(local.id, 'sync', 'A'); await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  expect((await getNote('local-two')).content_id).toBe('canonical-two')
  expect((await readItemSyncPolicy('local-two', 'A')).mode).toBe('local-only')
  expect(Object.values((await readWorkspace('A')).mappings)).toEqual([])
})

test('an existing ACK preserves sync; mapping/cache without acknowledgement is not authorization', async () => {
  await writeWorkspace('A', acknowledged())
  expect((await readItemSyncPolicy(local, 'A')).authorization).toBe('legacy-ack')
  const state = acknowledged(); state.mappings['note:local-one'].signature = ''
  await writeWorkspace('A', state)
  expect((await readItemSyncPolicy(local, 'A')).mode).toBe('local-only')
  await syncWorkspace(); expect(integrationJson).not.toHaveBeenCalled()
})

test('pause retains body/history and unknown operation; cancelled receipt queries cannot send or receive', async () => {
  const state = acknowledged()
  state.mappings['note:local-one'].pending = { dispatched: true, signature: 'pending', body: { base_revision: 7, operation_id: 'old-op', title: local.title, content: local.content, source_type: 'text', source_device: 'App', versions: [] } }
  await writeWorkspace('A', state)
  await Storage.setItem('vinote:A:note-history:local-one', JSON.stringify([{ content: 'original', savedAt: local.created_at }]))
  await setItemSyncPolicy(local.id, 'local-only', 'A')
  await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  await expect(queryWorkspaceOperation(remote.key, 'old-op', 'A')).rejects.toThrow('跨设备同步已取消')
  expect(integrationJson).not.toHaveBeenCalled()
  expect((await readWorkspace('A')).mappings['note:local-one'].pending?.body.operation_id).toBe('old-op')
  expect((await readItemSyncPolicy(local.id, 'A')).mode).toBe('local-only')
  expect(await Storage.getItem('vinote:A:note-history:local-one')).toContain('original')
  expect(mutations()).toEqual([])
})

test('unknown original request 404 keeps intent and never turns into a new POST', async () => {
  const state = acknowledged()
  state.mappings['note:local-one'].deleteOperation = { operation_id: 'old-op', base_revision: 7, action: 'delete', serviceOrigin: integrationBaseUrl }
  await writeWorkspace('A', state)
  jest.mocked(integrationJson).mockRejectedValue(new IntegrationError('not found', 404, 'NOT_FOUND'))
  await expect(queryWorkspaceOperation(remote.key, 'old-op', 'A')).rejects.toThrow('跨设备同步已取消')
  expect(integrationJson).not.toHaveBeenCalled()
  expect((await readWorkspace('A')).mappings['note:local-one'].deleteOperation?.operation_id).toBe('old-op')
  expect(mutations()).toEqual([])
})

test('legacy capability responses cannot reactivate cancelled synchronization', async () => {
  await setItemSyncPolicy(local.id, 'sync', 'A')
  jest.mocked(integrationJson).mockResolvedValue({ mode: 'shared', capabilities: { notes: true } } as never)
  await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  expect(mutations()).toEqual([]); expect(prepareWorkspaceMarkdown).not.toHaveBeenCalled()
  expect((await readItemSyncPolicy(local.id, 'A')).mode).toBe('sync')
})

test('unreadable capabilities are not consulted when reading this device library', async () => {
  await setItemSyncPolicy(local.id, 'sync', 'A')
  jest.mocked(integrationJson).mockResolvedValue({ mode: 'shared' } as never)
  await syncWorkspace()
  expect(mutations()).toEqual([])
  jest.mocked(integrationJson).mockRejectedValue(new Error('账号尚未核验'))
  await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  expect(mutations()).toEqual([])
})

test('legacy policy changes cannot start a cloud read or replace the retained cached body', async () => {
  await writeWorkspace('A', acknowledged()); await Storage.removeItem('vinote:A:note:local-one')
  jest.mocked(integrationJson).mockRejectedValue(new Error('must not read cloud'))
  await syncWorkspace()
  await setItemSyncPolicy(`workspace-${remote.key}`, 'local-only', 'A')
  await syncWorkspace()
  expect(integrationJson).not.toHaveBeenCalled()
  expect((await readWorkspace('A')).cache[remote.key].revision).toBe(7)
  expect((await getNote(`workspace-${remote.key}`)).content).toBe(remote.content)
})

test('failed durable pause keeps prior selection, and a different owner cannot write the same id', async () => {
  await writeWorkspace('A', acknowledged())
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    if (key.includes(':item-sync:')) throw new Error('storage full')
    return originalSet(key, value)
  })
  await expect(setItemSyncPolicy(local.id, 'local-only', 'A')).rejects.toThrow('storage full')
  expect((await readItemSyncPolicy(local.id, 'A')).mode).toBe('sync')
  account = 'B'; transitionIdentity('B')
  await expect(setItemSyncPolicy(local.id, 'sync', 'A')).rejects.toThrow()
  expect(jest.mocked(Storage.setItem).mock.calls.some(([key]) => key.startsWith('vinote:B:'))).toBe(false)
})
