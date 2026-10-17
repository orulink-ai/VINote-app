import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readAccountId, sessionRevision } from './storage'
import { readWorkspace, writeWorkspace, workspaceNote, type WorkspaceNote, type WorkspaceState, type WorkspaceVersion } from './workspaceStorage'
import type { Note } from '../types/api'

// Conversion is device-only. No tokens, remote requests or replay of old intents.
let converting: Promise<void> = Promise.resolve()
export function localLibrary(owner: string): Promise<WorkspaceState> {
  const job = converting.catch(() => {}).then(() => convert(owner))
  converting = job.then(() => {}, () => {})
  return job
}
async function convert(owner: string): Promise<WorkspaceState> {
  const generation = sessionRevision?.() ?? 0
  const guard = async () => {
    if ((sessionRevision?.() ?? 0) !== generation || await readAccountId() !== owner)
      throw new Error('账号已切换，原账号资料仍保留')
  }
  await guard()
  const state = await readWorkspace(owner)
  await guard()
  if (state.localOnly) return state
  if (state.error && !Object.keys(state.cache).length && !Object.keys(state.mappings).length) throw new Error(state.error)
  if (!Object.keys(state.cache).length && !Object.keys(state.mappings).length) return { ...state, localOnly: true }
  const next = detachWorkspace(state)
  // Keep the complete old baselines/operations independently of rotating snapshots.
  const archive = `${FS.DocumentDirectoryPath}/local-library-legacy-${encodeURIComponent(owner)}.json`
  if (!await FS.exists(archive)) { await guard(); await FS.writeFile(archive, JSON.stringify(state), 'utf8') }
  await guard()
  await writeWorkspace(owner, next, () => {
    if ((sessionRevision?.() ?? 0) !== generation) throw new Error('账号已切换，原账号资料仍保留')
  })
  await guard()
  return next
}

export function detachWorkspace(input: WorkspaceState): WorkspaceState {
  const state = JSON.parse(JSON.stringify(input)) as WorkspaceState
  for (const mapping of Object.values(state.mappings)) {
    const old = state.cache[mapping.key], pending = mapping.pending
    const body = pending?.body
    if (!old && !body) continue // Never invent a missing cloud body.
    const row: WorkspaceNote = old || {
      key: mapping.key, title: body!.title, content: body!.content, source_type: body!.source_type,
      source_device: body!.source_device, revision: body!.base_revision, created_at: '', updated_at: '',
      deleted: false, archived: !!body!.archived, transcript: body!.transcript || null,
      metadata: body!.metadata || {}, versions: [], next_versions_offset: null, version_count: 0,
    }
    const versions: WorkspaceVersion[] = [...row.versions, ...(mapping.conflict?.versions || []), ...(body?.versions || []), ...(pending?.remaining || [])]
    const preserve = (id: string, title: string, content: string, created_at: string) => {
      if (!versions.some(value => value.content === content && value.created_at === created_at)) versions.push({ id, title, content, created_at, kind: 'edit' })
    }
    preserve(`retained-${mapping.key}`, row.title, row.content, row.updated_at)
    if (mapping.conflict) preserve(`conflict-${mapping.key}`, mapping.conflict.title, mapping.conflict.content, mapping.conflict.updated_at)
    if (body) {
      preserve(`pending-${body.operation_id}`, body.title, body.content, row.updated_at)
      Object.assign(row, { title: body.title, content: body.content, source_type: body.source_type,
        archived: !!body.archived, transcript: body.transcript ?? row.transcript, metadata: body.metadata ?? row.metadata })
      // Preserve acknowledged tombstones. Unknown intents never decide deletion.
    }
    row.versions = versions.filter((value, index) => versions.findIndex(other => other.id === value.id && other.content === value.content) === index)
    row.version_count = row.versions.length
    state.cache[mapping.key] = row
  }
  return { ...state, localOnly: true, syncing: false, error: undefined }
}

export function retainedNote(row: WorkspaceNote, state: WorkspaceState): Note {
  const mapping = Object.values(state.mappings).find(value => value.key === row.key)
  return workspaceNote(row, mapping)
}
