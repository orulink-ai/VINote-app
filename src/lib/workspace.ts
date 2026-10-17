// Compatibility boundary for older callers. Cross-device synchronization is removed.
import { localLibrary } from './localLibrary'
import { getNote, editNoteContent, setNoteDeleted } from './notes'
import { workspaceOwner, type WorkspaceNote } from './workspaceStorage'
import type { RemoteScope } from './sessionGate'
export { subscribeWorkspace, readWorkspace } from './workspaceStorage'
export const requestWorkspaceSync = () => {}
export const syncWorkspace = async () => { const owner = await workspaceOwner(); await localLibrary(owner) }
export const workspaceStatus = async () => ({ configured: false, mode: 'device', media_sync: false, server_time: '' })
export async function queryWorkspaceOperation(_key: string, _operation: string, _owner: string): Promise<{ operation_id: string; note_key: string; acknowledged_revision: number; status: string }> {
  throw new Error('跨设备同步已取消，原操作记录保留为归档，不再发送或查询')
}
export async function fetchWorkspaceNote(key: string, owner?: string, _scope?: RemoteScope, guard?: () => void): Promise<WorkspaceNote> {
  guard?.()
  const state = await localLibrary(owner || await workspaceOwner())
  guard?.()
  if (!state.cache[key]) throw new Error('这份正文尚未保存在设备中')
  return state.cache[key]
}
export class WorkspaceConflictChangedError extends Error { readonly code = 'WORKSPACE_CONFLICT_CHANGED' }
export async function resolveWorkspaceConflict(group: string, merged: string, comparedRevision: number, owner: string, operation: string) {
  const state = await localLibrary(owner), mapping = state.mappings[group]
  if (!mapping || mapping.pending?.body.operation_id !== operation || mapping.conflict?.revision !== comparedRevision) throw new WorkspaceConflictChangedError('原比较记录已变化，草稿保留')
  const id = mapping.localIds[0] || `workspace-${mapping.key}`
  const baseline = await getNote(id, { expectedOwner: owner })
  await editNoteContent(id, merged, baseline, owner)
}
export async function setWorkspaceDeleted(key: string, deleted: boolean) { await setNoteDeleted(`workspace-${key}`, deleted) }
