import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { integrationJson, IntegrationError } from '../src/lib/integration'
import { listLocalNotes } from '../src/lib/notes'
import { readWorkspace, writeWorkspace, type WorkspaceNote, type WorkspaceState } from '../src/lib/workspaceStorage'
import { setWorkspaceDeleted, syncWorkspace, resolveWorkspaceConflict, queryWorkspaceOperation } from '../src/lib/workspace'
import { beginVerification, finishVerification, identityScope } from '../src/lib/sessionGate'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/notes', () => ({ listLocalNotes: jest.fn(async () => []), noteRevisions: jest.fn(async () => []) }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/workspaceAttachments', () => ({ prepareWorkspaceMarkdown: jest.fn(async (text: string) => text) }))
jest.mock('../src/lib/integration', () => ({
  integrationBaseUrl: 'https://shared.example', operationId: jest.fn(), integrationJson: jest.fn(),
  IntegrationError: class extends Error {
    constructor(message: string, status: number, code: string, current?: unknown) { super(message); Object.assign(this, { status, code, current }) }
  },
}))

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const remoteNote = (patch: Partial<WorkspaceNote> = {}): WorkspaceNote => ({
  key: 'shared-note', title: '会议', content: '基线 A', source_type: 'text', source_device: '手机',
  revision: 1, updated_at: '2026-10-12T00:00:00Z', created_at: '2026-10-11T00:00:00Z',
  deleted: false, archived: false, version_count: 1, transcript: null, metadata: { project: '原项目' },
  versions: [], next_versions_offset: null, ...patch,
})
let cloud: WorkspaceNote
let mutations: Array<{ action: string; id: string; base: number }>
let receipts: Map<string, { action: string; base: number }>
let nextId: number
let loseResponse: boolean
let rejectReads: boolean

beforeEach(async () => {
  finishVerification(beginVerification('owner'), 'verified')
  jest.clearAllMocks()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  const files = new Map<string, string>()
  jest.mocked(FS.writeFile).mockImplementation(async (path, body) => { files.set(path, body); return undefined as never })
  jest.mocked(FS.readFile).mockImplementation(async path => files.get(path)!)
  jest.mocked(FS.unlink).mockImplementation(async path => { files.delete(path) })
  jest.mocked(listLocalNotes).mockResolvedValue([])
  cloud = remoteNote(); mutations = []; receipts = new Map(); nextId = 0; loseResponse = false; rejectReads = false
  const { operationId } = require('../src/lib/integration')
  operationId.mockImplementation(() => `new-operation-${++nextId}`)
  ;(integrationJson as jest.Mock).mockImplementation(async (path: string, init: RequestInit = {}) => {
    const url = new URL(path, 'https://shared.example')
    if (url.pathname.endsWith('/status')) return { mode: 'shared', capabilities: { item_sync_policy: 1, operation_receipts: 1 } }
    if (url.pathname.includes('/operations/')) {
      if (rejectReads) throw new Error('读取离线')
      const id = decodeURIComponent(url.pathname.split('/').pop()!)
      if (!receipts.has(id)) throw new IntegrationError('未找到原操作', 404, 'NOT_FOUND')
      return { operation_id: id, note_key: cloud.key, acknowledged_revision: receipts.get(id)!.base + 1, status: 'acknowledged' }
    }
    if (url.pathname === '/api/workspace/notes' && !init.method) return { items: [{ key: cloud.key, revision: cloud.revision }], next_offset: null }
    if (!init.method) {
      if (rejectReads) throw new Error('读取离线')
      return clone(cloud)
    }
    if (init.method === 'PUT') throw new Error('写入离线') // Keep the exact pending body available for assertions.
    const action = init.method === 'DELETE' ? 'delete' : 'restore'
    const body = init.method === 'DELETE'
      ? { operation_id: url.searchParams.get('operation_id')!, base_revision: Number(url.searchParams.get('base_revision')) }
      : JSON.parse(init.body as string)
    mutations.push({ action, id: body.operation_id, base: body.base_revision })
    const prior = receipts.get(body.operation_id)
    if (prior) {
      if (prior.action !== action || prior.base !== body.base_revision) throw new IntegrationError('操作标识已使用', 409, 'OPERATION_REUSED')
      return clone(cloud)
    }
    if (body.base_revision !== cloud.revision) throw new IntegrationError('修订冲突', 409, 'REVISION_CONFLICT', clone(cloud))
    receipts.set(body.operation_id, { action, base: body.base_revision })
    cloud = { ...cloud, revision: cloud.revision + 1, deleted: action === 'delete' }
    if (loseResponse) { loseResponse = false; throw new Error('回执丢失') }
    return clone(cloud)
  })
})

async function seedMigration(baseline: WorkspaceNote | undefined, remote: WorkspaceNote, draft: Partial<WorkspaceNote> = {}) {
  cloud = remote
  const local = { id: 'local-note', title: '会议', content: '草稿 C', source_type: 'text', status: 'done' as const,
    created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
  jest.mocked(listLocalNotes).mockResolvedValue([local])
  const state: WorkspaceState = { serviceOrigin: 'https://old.example', cache: baseline ? { [baseline.key]: baseline } : {}, mappings: {
    'note:local-note': { key: cloud.key, group: 'note:local-note', localIds: [local.id], revision: 1, signature: '', status: 'pending',
      pending: { signature: 'draft', dispatched: false, body: { base_revision: 1, operation_id: 'original-write',
        title: '会议', content: '草稿 C', source_type: 'text', source_device: '手机', archived: false,
        transcript: null, metadata: { project: '原项目' }, versions: [], ...draft } } },
  } }
  await writeWorkspace('owner', state)
  await Storage.setItem(`vinote:owner:item-sync:${encodeURIComponent('https://shared.example')}:${cloud.key}`, JSON.stringify({ version: 1, contentId: cloud.key, mode: 'sync', authOrigin: identityScope('owner').authOrigin }))
}
const putCalls = () => (integrationJson as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PUT')

describe('merge binds the revision actually compared', () => {
  async function seedConflict() {
    await seedMigration(remoteNote(), remoteNote({ revision: 2, content: '已比较远端 B' }))
    const state = await readWorkspace('owner')
    state.serviceOrigin = 'https://shared.example'
    state.mappings['note:local-note'].status = 'conflict'
    state.mappings['note:local-note'].conflict = clone(cloud)
    await writeWorkspace('owner', state)
  }
  it('remote third edit refreshes the comparison but sends no PUT and preserves original intent', async () => {
    await seedConflict(); cloud = remoteNote({ revision: 3, content: '未比较远端 C' })
    await expect(resolveWorkspaceConflict('note:local-note', '合并', 2, 'owner', 'original-write')).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT_CHANGED' })
    const state = await readWorkspace('owner')
    expect(putCalls()).toHaveLength(0)
    expect(state.mappings['note:local-note'].pending?.body).toMatchObject({ operation_id: 'original-write', base_revision: 1, content: '草稿 C' })
    expect(state.mappings['note:local-note'].conflict).toMatchObject({ revision: 3, content: '未比较远端 C' })
    expect(state.cache[cloud.key].revision).toBe(3)
  })
  it('explicit fresh comparison can proceed despite older cache, with exact compared CAS', async () => {
    await seedConflict(); cloud = remoteNote({ revision: 3, content: '用户重新比较 C' })
    await resolveWorkspaceConflict('note:local-note', '明确合并', 3, 'owner', 'original-write')
    expect(putCalls()).toHaveLength(1)
    expect(JSON.parse(putCalls()[0][1].body)).toMatchObject({ base_revision: 3, content: '明确合并' })
  })
  it('rejects stale operation or owner before any GET or PUT', async () => {
    await seedConflict(); jest.mocked(integrationJson).mockClear()
    await expect(resolveWorkspaceConflict('note:local-note', '合并', 2, 'other', 'original-write')).rejects.toMatchObject({ code: 'WORKSPACE_OPERATION_CHANGED' })
    await expect(resolveWorkspaceConflict('note:local-note', '合并', 2, 'owner', 'old-operation')).rejects.toMatchObject({ code: 'WORKSPACE_OPERATION_CHANGED' })
    expect(integrationJson).not.toHaveBeenCalled()
  })
  it('tombstone remains a conflict and cannot turn into merged PUT', async () => {
    await seedConflict(); cloud = remoteNote({ revision: 3, deleted: true })
    await expect(resolveWorkspaceConflict('note:local-note', '合并', 2, 'owner', 'original-write')).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT_CHANGED' })
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].conflict?.deleted).toBe(true)
  })
})

describe('cross-service three-way recovery', () => {
  it('preserves A as the comparison baseline and never writes C over remote B', async () => {
    await seedMigration(remoteNote(), remoteNote({ content: '远端 B', revision: 4 }))
    await syncWorkspace()
    const state = await readWorkspace('owner'), mapping = state.mappings['note:local-note']
    expect(putCalls()).toHaveLength(0)
    expect(mapping.status).toBe('conflict')
    expect(mapping.conflict?.content).toBe('远端 B')
    expect(mapping.pending?.body).toMatchObject({ content: '草稿 C', base_revision: 1, operation_id: 'original-write' })
  })

  it.each([
    ['title', { title: '远端名称' }], ['metadata', { metadata: { project: '远端项目' } }],
    ['evidence', { transcript: { full_text: '另一份证据' } }], ['archive', { archived: true }], ['tombstone', { deleted: true }],
  ])('does not silently overwrite a remote %s change', async (_label, patch) => {
    await seedMigration(remoteNote(), remoteNote({ ...patch, revision: 4 }))
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].status).toBe('conflict')
  })

  it.each([undefined, remoteNote({ revision: 2 })])('requires a trustworthy old baseline before rebasing', async baseline => {
    await seedMigration(baseline, remoteNote({ revision: 4 }))
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].pending?.body.operation_id).toBe('original-write')
  })

  it.each(['unchanged baseline', 'identical draft'])('allows a confirmed safe migration: %s', async mode => {
    await seedMigration(remoteNote(), remoteNote({ revision: 4, content: mode === 'identical draft' ? '草稿 C' : '基线 A' }))
    await syncWorkspace()
    expect(putCalls()).toHaveLength(1)
    const body = JSON.parse(putCalls()[0][1].body)
    expect(body).toMatchObject({ base_revision: 4, content: '草稿 C' })
    expect(body.operation_id).not.toBe('original-write')
    expect((await readWorkspace()).mappings['note:local-note'].pending?.body).toEqual(body)
  })

  it('also protects a local draft that has not yet created its pending request', async () => {
    await seedMigration(remoteNote(), remoteNote({ content: '远端 B', revision: 1 }))
    const state = await readWorkspace(); state.mappings['note:local-note'].pending = undefined
    await writeWorkspace('owner', state)
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].status).toBe('conflict')
  })

  it('preserves the old comparison baseline across an interrupted migration', async () => {
    await seedMigration(remoteNote(), remoteNote({ content: '远端 B', revision: 1 }))
    const state = await readWorkspace(); state.mappings['note:local-note'].pending = undefined
    await writeWorkspace('owner', state)
    jest.mocked(listLocalNotes).mockRejectedValueOnce(new Error('本地读盘中断'))
    await expect(syncWorkspace()).rejects.toThrow('本地读盘中断')
    const interrupted = await readWorkspace()
    expect(interrupted.serviceOrigin).toBe('https://old.example')
    expect(interrupted.cache[cloud.key].content).toBe('基线 A')
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].status).toBe('conflict')
  })

  it('creates at revision zero when the new service definitively has no source record', async () => {
    await seedMigration(remoteNote(), remoteNote())
    const state = await readWorkspace(); state.mappings['note:local-note'].pending = undefined
    await writeWorkspace('owner', state)
    const handler = (integrationJson as jest.Mock).getMockImplementation()!
    ;(integrationJson as jest.Mock).mockImplementation(async (path, init, ...args) => {
      if (!init?.method && path.includes('/notes?')) return { items: [], next_offset: null }
      if (!init?.method && path.includes('/notes/')) throw new IntegrationError('不存在', 404, 'NOT_FOUND')
      return handler(path, init, ...args)
    })
    await syncWorkspace()
    expect(putCalls()).toHaveLength(1)
    expect(JSON.parse(putCalls()[0][1].body).base_revision).toBe(0)
  })
})

describe('local editing CAS baseline', () => {
  it('uses the source draft revision instead of the mapping revision advanced by a pull', async () => {
    await seedMigration(remoteNote(), remoteNote({ content: '远端 B', revision: 2 }))
    const state = await readWorkspace()
    state.serviceOrigin = 'https://shared.example'; state.cache[cloud.key] = clone(cloud)
    state.mappings['note:local-note'].pending = undefined; state.mappings['note:local-note'].revision = 2
    await writeWorkspace('owner', state)
    jest.mocked(listLocalNotes).mockResolvedValue([{ id: 'local-note', workspace_key: cloud.key, workspace_revision: 1,
      title: '会议', content: '本地编辑 C', source_type: 'text', status: 'done', created_at: cloud.created_at, updated_at: cloud.updated_at }])
    const handler = (integrationJson as jest.Mock).getMockImplementation()!
    ;(integrationJson as jest.Mock).mockImplementation(async (path, init, ...args) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body)
        if (body.base_revision !== cloud.revision) throw new IntegrationError('修订冲突', 409, 'REVISION_CONFLICT', clone(cloud))
        cloud.content = body.content
        return clone(cloud)
      }
      return handler(path, init, ...args)
    })
    await syncWorkspace()
    expect(JSON.parse(putCalls()[0][1].body).base_revision).toBe(1)
    expect(cloud.content).toBe('远端 B')
    const mapping = (await readWorkspace()).mappings['note:local-note']
    expect(mapping.status).toBe('conflict')
    expect(mapping.pending?.body.content).toBe('本地编辑 C')
  })

  it('keeps a shared local draft without its editing revision in conflict', async () => {
    await seedMigration(remoteNote(), remoteNote({ revision: 2 }))
    const state = await readWorkspace(); state.serviceOrigin = 'https://shared.example'
    state.cache[cloud.key] = clone(cloud); state.mappings['note:local-note'].pending = undefined
    await writeWorkspace('owner', state)
    jest.mocked(listLocalNotes).mockResolvedValue([{ id: 'local-note', workspace_key: cloud.key,
      title: '会议', content: '本地编辑 C', status: 'done', created_at: cloud.created_at, updated_at: cloud.updated_at }])
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect((await readWorkspace()).mappings['note:local-note'].status).toBe('conflict')
  })
})

async function seedDeletion(operation?: { operation_id: string; base_revision: number; action?: 'delete' | 'restore' }) {
  await writeWorkspace('owner', { serviceOrigin: 'https://shared.example', cache: { [cloud.key]: clone(cloud) }, mappings: {
    remote: { key: cloud.key, group: 'remote', localIds: [], signature: '', revision: cloud.revision, status: 'synced', deleteOperation: operation },
  } })
}

describe('delete/restore receipt recovery', () => {
  it('queries a lost delete by exact original ID and never sends restore or replays DELETE', async () => {
    await seedDeletion(); loseResponse = true
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('回执丢失')
    const operation = (await readWorkspace()).mappings.remote.deleteOperation!
    expect(operation).toMatchObject({ action: 'delete', base_revision: 1 })
    await syncWorkspace() // Receipt is still pending, but tombstone readback is available.
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('不重复派发')
    expect(await queryWorkspaceOperation(cloud.key, operation.operation_id, 'owner')).toMatchObject({ acknowledged_revision: 2 })
    expect(mutations.map(row => row.action)).toEqual(['delete'])
    expect(cloud).toMatchObject({ revision: 2, deleted: true })
    expect((await readWorkspace()).mappings.remote.deleteOperation).toEqual(operation)
  })

  it('queries a lost restore without replaying even the same ID', async () => {
    cloud = remoteNote({ deleted: true, revision: 5 }); await seedDeletion(); loseResponse = true
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('回执丢失')
    const saved = (await readWorkspace()).mappings.remote.deleteOperation!
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('不重复派发')
    expect(await queryWorkspaceOperation(cloud.key, saved.operation_id, 'owner')).toMatchObject({ acknowledged_revision: 6 })
    expect(saved.action).toBe('restore')
    expect(mutations).toHaveLength(1)
    expect((await readWorkspace()).mappings.remote.deleteOperation).toEqual(saved)
    expect(cloud.revision).toBe(6)
  })

  it.each([true, false])('never guesses the action of a legacy ID (deleted=%s)', async deleted => {
    cloud = remoteNote({ deleted, revision: 4 }); await seedDeletion({ operation_id: 'legacy-id', base_revision: 1 })
    receipts.set('legacy-id', { action: deleted ? 'delete' : 'restore', base: 1 })
    await expect(setWorkspaceDeleted(cloud.key, !deleted)).rejects.toThrow('不重复派发')
    expect(await queryWorkspaceOperation(cloud.key, 'legacy-id', 'owner')).toMatchObject({ acknowledged_revision: 2 })
    expect(mutations).toHaveLength(0)
    expect(cloud.deleted).toBe(deleted)
    expect((await readWorkspace()).mappings.remote.deleteOperation?.operation_id).toBe('legacy-id')
  })

  it('preserves a legacy unknown operation when readback is unavailable', async () => {
    const old = { operation_id: 'legacy-id', base_revision: 1 }; await seedDeletion(old); rejectReads = true
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('不重复派发')
    await expect(queryWorkspaceOperation(cloud.key, 'legacy-id', 'owner')).rejects.toThrow('读取离线')
    expect(mutations).toHaveLength(0)
    expect((await readWorkspace()).mappings.remote.deleteOperation).toEqual(old)
  })

  it('does not dispatch any operation if durable intent saving fails', async () => {
    await seedDeletion(); jest.mocked(FS.writeFile).mockRejectedValueOnce(new Error('磁盘已满'))
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('磁盘已满')
    expect(mutations).toHaveLength(0)
  })

  it('keeps a lost delete intent when exact receipt reading is offline and never sends restore', async () => {
    await seedDeletion(); loseResponse = true
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('回执丢失')
    const saved = (await readWorkspace()).mappings.remote.deleteOperation
    const handler = (integrationJson as jest.Mock).getMockImplementation()!
    ;(integrationJson as jest.Mock).mockImplementation(async (path, init, ...args) => {
      if (path.includes('/operations/')) throw new Error('核验离线')
      return handler(path, init, ...args)
    })
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('不重复派发')
    await expect(queryWorkspaceOperation(cloud.key, saved!.operation_id, 'owner')).rejects.toThrow('核验离线')
    expect((await readWorkspace()).mappings.remote.deleteOperation).toEqual(saved)
    expect(mutations).toHaveLength(1)
    expect(cloud.deleted).toBe(true)
  })

  it('a stored stale ID with no original receipt remains frozen, never guesses rejection from latest state', async () => {
    cloud = remoteNote({ revision: 4 }); await seedDeletion({ operation_id: 'stale-delete', base_revision: 1, action: 'delete' })
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('不重复派发')
    await expect(queryWorkspaceOperation(cloud.key, 'stale-delete', 'owner')).rejects.toMatchObject({ status: 404 })
    expect(mutations).toEqual([])
    expect(cloud).toMatchObject({ deleted: false, revision: 4 })
    expect((await readWorkspace()).mappings.remote.deleteOperation?.operation_id).toBe('stale-delete')
  })

  it('latest state matching requested state is not an original legacy receipt', async () => {
    cloud = remoteNote({ deleted: true, revision: 4 }); await seedDeletion({ operation_id: 'legacy-id', base_revision: 1 })
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('不重复派发')
    await expect(queryWorkspaceOperation(cloud.key, 'legacy-id', 'owner')).rejects.toMatchObject({ status: 404 })
    expect(mutations).toHaveLength(0)
    expect((await readWorkspace()).mappings.remote.deleteOperation?.operation_id).toBe('legacy-id')
  })

  it('does not replay a recorded operation into a different service', async () => {
    await seedDeletion({ operation_id: 'old-delete', base_revision: 1, action: 'delete' })
    const state = await readWorkspace(); state.mappings.remote.deleteOperation!.serviceOrigin = 'https://old.example'
    await writeWorkspace('owner', state)
    await expect(setWorkspaceDeleted(cloud.key, false)).rejects.toThrow('不重复派发')
    await expect(queryWorkspaceOperation(cloud.key, 'old-delete', 'owner')).rejects.toThrow('原操作的服务来源')
    expect(mutations).toHaveLength(0)
    expect((await readWorkspace()).mappings.remote.deleteOperation?.operation_id).toBe('old-delete')
  })

  it('does not upload local edits while a delete receipt is unknown', async () => {
    await seedDeletion({ operation_id: 'unknown-delete', base_revision: 1, action: 'delete' })
    const state = await readWorkspace(); state.mappings.remote.localIds = ['local-note']
    await writeWorkspace('owner', state)
    jest.mocked(listLocalNotes).mockResolvedValue([{ id: 'local-note', title: '会议', content: '未提交编辑',
      status: 'done', created_at: cloud.created_at, updated_at: cloud.updated_at }])
    await syncWorkspace()
    expect(putCalls()).toHaveLength(0)
    expect(mutations).toHaveLength(0)
    expect((await readWorkspace()).mappings.remote.deleteOperation?.operation_id).toBe('unknown-delete')
  })

  it('serializes deletion and foreground synchronization while saving intent', async () => {
    await seedDeletion()
    const save = jest.mocked(FS.writeFile).getMockImplementation()!
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    jest.mocked(FS.writeFile).mockImplementationOnce(async (path, body, ...args) => { await waiting; return save(path, body, ...args) })
    const first = setWorkspaceDeleted(cloud.key, true)
    const sync = syncWorkspace()
    await expect(setWorkspaceDeleted(cloud.key, true)).rejects.toThrow('同步仍在进行')
    release(); await first; await sync
    expect(mutations).toHaveLength(1)
    expect(cloud.deleted).toBe(true)
  })
})
