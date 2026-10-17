import type { WorkspaceMapping, WorkspaceState } from './workspaceStorage'

/** Read-only navigation identity. Missing workspace IDs are never fabricated. */
export type WorkspaceSyncTarget = { owner: string; serviceOrigin: string; key?: string; group?: string; operationId?: string; localId?: string }
export type WorkspaceSyncTargetResult = { status: 'checking' | 'account-changed' | 'service-changed' | 'missing' | 'operation-changed' | 'ambiguous' | 'matched'; message: string; mapping?: WorkspaceMapping }
export function workspaceSyncTargetIdentity(target?: WorkspaceSyncTarget): string {
  return target ? JSON.stringify([target.owner, target.serviceOrigin, target.key || '', target.group || '', target.operationId || '', target.localId || '']) : ''
}
export function resolveWorkspaceSyncTarget(target: WorkspaceSyncTarget, owner: string | null, state: WorkspaceState, serviceOrigin: string): WorkspaceSyncTargetResult {
  if (!owner) return { status: 'checking', message: '正在核对原内容的本机同步记录…' }
  if (owner !== target.owner) return { status: 'account-changed', message: '账号已变化，不能定位原账号的同步记录；原账号内容与草稿保留。' }
  if (!target.serviceOrigin || target.serviceOrigin !== serviceOrigin || (state.serviceOrigin && state.serviceOrigin !== target.serviceOrigin)) return { status: 'service-changed', message: '共享服务已变化，请返回原服务核验；原内容与合并草稿不会迁移。' }
  const candidates = Object.values(state.mappings).filter(mapping =>
    (!target.group || mapping.group === target.group) && (!target.key || mapping.key === target.key) &&
    (!target.localId || mapping.localIds.includes(target.localId)) && !!(target.group || target.key || target.localId))
  if (!candidates.length) return { status: 'missing', message: '尚无匹配的同步记录，本机内容与草稿保留。不会自动建立同步请求。' }
  if (candidates.length !== 1) return { status: 'ambiguous', message: '存在多条关联同步记录，无法唯一定位；请核对下方记录，不按名称猜测或自动选择。' }
  const mapping = candidates[0]
  if (target.operationId && mapping.pending?.body.operation_id !== target.operationId && mapping.deleteOperation?.operation_id !== target.operationId) return { status: 'operation-changed', message: '原操作已不在当前待处理记录中，可能已确认或记录已变化。不会绑定新操作；本机内容与合并草稿保留。' }
  return { status: 'matched', mapping, message: target.operationId ? '已定位原操作。仅查看状态；比较、同步或恢复需由你另行选择。' : '已定位这份内容的同步记录。尚未指定原操作，不会自动开始同步或合并。' }
}
