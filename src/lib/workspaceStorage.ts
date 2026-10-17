import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { devReadSync as measureRead, devReadTiming as startRead, readAccountId } from './storage'
import type { Note } from '../types/api'
const devReadTiming: typeof startRead = startRead ?? (() => () => {})
const devReadSync: typeof measureRead = measureRead ?? ((_stage, action) => action())

export type WorkspaceVersion = { id: string; title: string; content: string; created_at: string; kind?: 'generated' | 'edit' | 'imported'; model?: string; parent_id?: string; evidence_revision?: number | null }
export type WorkspaceNote = {
  key: string; title: string; content: string; source_type: string; source_device: string; revision: number
  updated_at: string; created_at: string; deleted: boolean; archived: boolean; version_count: number
  transcript: { full_text?: string; segments?: Array<{ start: number; end: number; text: string; speaker_id?: string; speaker_label?: string; timestamp_estimated?: boolean }>; aliases?: Record<string, string>; speaker_intervals?: Array<{ start: number; end: number; speaker_id?: string; overlap: boolean }> } | null
  metadata: { duration?: number; recording_started_at?: string; recording_ended_at?: string; media_id?: string; source_device_id?: string; default_version_id?: string; source_created_at?: string; project?: string | null; tags?: string[] | null }
  versions: WorkspaceVersion[]; next_versions_offset: number | null
}
export type WorkspaceWrite = {
  base_revision: number; operation_id: string; title: string; content: string; source_type: string; source_device: string
  archived?: boolean; transcript?: WorkspaceNote['transcript']; metadata?: WorkspaceNote['metadata']; versions: WorkspaceVersion[]
}
export type WorkspaceMapping = {
  key: string; group: string; localIds: string[]; signature: string; revision: number
  localRecordingId?: string
  status: 'local' | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'; error?: string
  pending?: { signature: string; body: WorkspaceWrite; remaining?: WorkspaceVersion[]; dispatched?: boolean; serviceOrigin?: string }; conflict?: WorkspaceNote
  // Missing action identifies a legacy receipt whose intent must not be guessed.
  deleteOperation?: { operation_id: string; base_revision: number; action?: 'delete' | 'restore'; serviceOrigin?: string }
  acknowledgedOperation?: { operation_id: string; revision: number }
}
export type WorkspaceState = { mappings: Record<string, WorkspaceMapping>; cache: Record<string, WorkspaceNote>; localOnly?: boolean; lastSync?: string; error?: string; syncing?: boolean; serviceMode?: string; serviceOrigin?: string }
export async function workspaceOwner() {
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  return owner
}
export async function readWorkspace(owner?: string): Promise<WorkspaceState> {
  return (await readWorkspaceSnapshot(owner)).state
}
// Provenance accompanies the actual file read, never a separately guessed pointer.
// Callers may use it for display projections; every invocation still reads storage.
export async function readWorkspaceSnapshot(owner?: string): Promise<{ state: WorkspaceState; pointer: string | null }> {
  const total = devReadTiming('workspace.total')
  let step = devReadTiming('workspace.owner')
  try {
    const id = owner || await workspaceOwner()
    step()
    step = devReadTiming('workspace.pointer')
    const pointer = await Storage.getItem(`vinote:${id}:workspace-file`)
    step(pointer ? 'ok' : 'empty')
    if (pointer) {
      const head = devReadSync('workspace.pointer_parse', () => JSON.parse(pointer) as { file: string; previous?: string })
      try {
        step = devReadTiming('workspace.file_read')
        const body = await FS.readFile(snapshotFile(id, head.file), 'utf8')
        step()
        const state = devReadSync('workspace.parse', () => JSON.parse(body))
        total(); return { state, pointer }
      } catch (cause) {
        step('failed')
        step = devReadTiming('workspace.pointer_retry')
        const latest = await Storage.getItem(`vinote:${id}:workspace-file`)
        step(latest !== pointer ? 'retry' : 'ok')
        if (latest !== pointer) { total('retry'); return readWorkspaceSnapshot(id) }
        throw cause // Never report unreadable persisted content as an empty synced cache.
      }
    }
    const file = workspaceFile(id)
    step = devReadTiming('workspace.legacy_exists')
    const exists = await FS.exists(file)
    step(exists ? 'ok' : 'empty')
    if (exists) {
      step = devReadTiming('workspace.file_read')
      const body = await FS.readFile(file, 'utf8')
      step()
      const state = devReadSync('workspace.parse', () => JSON.parse(body))
      total(); return { state, pointer: null }
    }
    try {
      step = devReadTiming('workspace.legacy_read')
      const body = await Storage.getItem(`vinote:${id}:workspace`)
      step(body ? 'ok' : 'empty')
      const state = devReadSync('workspace.parse', () => JSON.parse(body || '{"mappings":{},"cache":{}}'))
      total(); return { state, pointer: null }
    } catch (cause) {
      step('failed')
      if (!String(cause).includes('CursorWindow')) throw cause
      // Preserve the legacy database row. Local note drafts are separate and are
      // merged on the next sync; never delete an unreadable legacy snapshot.
      total('recovered')
      return { state: { mappings: {}, cache: {}, error: '旧版缓存超过系统读取限制，已保留。请重新同步云端正文；本地笔记与原文件仍在。' }, pointer: null }
    }
  } catch (cause) { step('failed'); total('failed'); throw cause }
}
function workspaceFile(owner: string) { return `${FS.DocumentDirectoryPath}/workspace-${encodeURIComponent(owner)}.json` }
function snapshotFile(owner: string, file: string) {
  if (!/^[0-9]+-[a-f0-9]+$/.test(file)) throw new Error('正文缓存索引无效，请保留本地内容并重试')
  return `${FS.DocumentDirectoryPath}/workspace-${encodeURIComponent(owner)}-${file}.json`
}
let saving: Promise<void> = Promise.resolve()
export function writeWorkspace(owner: string, state: WorkspaceState, guard?: () => void): Promise<void> {
  guard?.()
  const body = JSON.stringify(state)
  const job = saving.catch(() => {}).then(() => commitWorkspace(owner, body, guard))
  saving = job
  return job
}
async function commitWorkspace(owner: string, body: string, guard?: () => void) {
  guard?.()
  if (await readAccountId() !== owner) throw new Error('账号已切换，原账号待同步内容已保留')
  guard?.()
  const pointerKey = `vinote:${owner}:workspace-file`
  const previous = JSON.parse(await Storage.getItem(pointerKey) || '{}') as { file?: string; previous?: string }
  guard?.()
  const file = `${Date.now()}-${Math.random().toString(16).slice(2) || '0'}`
  await FS.writeFile(snapshotFile(owner, file), body, 'utf8')
  if (await readAccountId() !== owner) throw new Error('账号已切换，原账号待同步内容已保留')
  guard?.()
  // The small SQLite pointer commits only after the complete immutable snapshot.
  // No destination overwrite is needed on iOS. Keep the prior snapshot as recovery.
  await Storage.setItem(pointerKey, JSON.stringify({ file, previous: previous.file }))
  guard?.()
  if (previous.previous) await FS.unlink(snapshotFile(owner, previous.previous)).catch(() => {})
  changed()
}
const listeners = new Set<() => void>()
export function subscribeWorkspace(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function changed() { listeners.forEach(listener => listener()) }
export function workspaceNote(note: WorkspaceNote, mapping?: WorkspaceMapping): Note {
  return { id: `workspace-${note.key}`, content_id: note.key, workspace_key: note.key, title: note.title, content: note.content,
    source_type: note.source_type, source_device: note.source_device, workspace_revision: note.revision,
    status: 'done', created_at: note.metadata.source_created_at || note.metadata.recording_started_at || '', updated_at: note.updated_at,
    workspace_version_id: note.versions.find(version => version.content === note.content && version.title === note.title)?.id,
    archived: note.archived, deleted: note.deleted, transcript: note.transcript,
    project: note.metadata.project, tags: note.metadata.tags || [],
    // Only an explicit local source mapping can grant playback. Never use remote media_id as a local path.
    task_id: mapping?.localRecordingId || (mapping?.group.startsWith('recording:') ? mapping.group.slice(10) : undefined),
    version: note.versions.filter(version => version.kind === 'generated').length || 1 }
}
export async function workspaceViews(local: Note[], snapshot?: WorkspaceState) {
  const state = snapshot ?? await readWorkspace()
  if (state.localOnly) {
    const rows = local.map(note => {
      const mapping = Object.values(state.mappings).find(value => value.localIds.includes(note.id))
      const row = state.cache[mapping?.key || note.workspace_key || '']
      const baseline = row?.versions.find(version => version.id === `retained-${row.key}`)
      return !note.deleted && row && mapping?.pending && baseline?.content === note.content && row.content !== note.content
        ? { ...workspaceNote(row, mapping), id: note.id, content_id: note.content_id || row.key, task_id: note.task_id } : note
    })
    for (const row of Object.values(state.cache)) {
      const mapping = Object.values(state.mappings).find(value => value.key === row.key)
      if (!rows.some(note => note.workspace_key === row.key || mapping?.localIds.includes(note.id))) rows.push(workspaceNote(row, mapping))
    }
    return rows.filter(note => !note.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }
  const virtual: Note[] = []
  for (const row of Object.values(state.cache)) {
    const mapping = Object.values(state.mappings).find(item => item.key === row.key)
    if (mapping?.pending || mapping?.status === 'conflict' || row.deleted) continue
    if (mapping?.localIds.some(id => local.some(note => note.id === id && note.updated_at > row.updated_at))) continue
    virtual.push(workspaceNote(row, mapping))
  }
  return [...local.filter(note => !virtual.some(row => row.workspace_key === note.workspace_key ||
    state.mappings[Object.keys(state.mappings).find(group => state.mappings[group].localIds.includes(note.id)) || '']?.key === row.workspace_key)), ...virtual]
    .filter(note => !note.deleted && !Object.values(state.mappings).some(map => map.localIds.includes(note.id) && state.cache[map.key]?.deleted && !map.pending && map.status !== 'conflict')).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
