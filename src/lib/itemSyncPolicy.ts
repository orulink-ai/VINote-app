import Storage from '@react-native-async-storage/async-storage'
import type { Note } from '../types/api'
import { getNote } from './notes'
import { integrationBaseUrl } from './integration'
import { AUTH_BASE_URL } from '../config/env'
import { identityScope, assertIdentity } from './sessionGate'
import { readWorkspace, changed, type WorkspaceState } from './workspaceStorage'
import { readAccountId } from './storage'

export type ItemSyncPolicy = { contentId: string; mode: 'local-only' | 'sync' | 'legacy-review'; authorization: 'explicit' | 'legacy-ack' | 'none'; pausedOperation?: string }
type SavedPolicy = { version: 1; contentId: string; mode: 'local-only' | 'sync'; authOrigin: string }
// Metadata only. A transition invalidates outstanding sync work, never caches bodies.
let epoch = 0
const listeners = new Set<() => void>()
export function subscribeItemPolicy(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export const itemPolicyEpoch = () => epoch
export function assertItemPolicyEpoch(expected: number) {
  if (epoch !== expected) throw new Error('此设备同步选择已变化，原待核验操作与正文保留')
}
const namespace = (owner: string) => `vinote:${owner}:item-sync:${encodeURIComponent(integrationBaseUrl.replace(/\/+$/, ''))}:`
export function canonicalContentId(note: Note, state: WorkspaceState): string {
  return note.workspace_key || Object.values(state.mappings).find(row => row.localIds.includes(note.id))?.key ||
    note.content_id || (note.id.startsWith('workspace-') ? note.id.slice(10) : `mobile-${note.id}`)
}
export async function policyForContent(owner: string, contentId: string, state: WorkspaceState): Promise<ItemSyncPolicy> {
  const scope = identityScope(owner)
  if (await readAccountId() !== owner) throw new Error('账号已切换')
  assertIdentity(scope)
  const value = await Storage.getItem(`${namespace(owner)}${contentId}`)
  assertIdentity(scope)
  if (await readAccountId() !== owner) throw new Error('账号已切换')
  assertIdentity(scope)
  const mapping = Object.values(state.mappings).find(row => row.key === contentId)
  const pausedOperation = mapping?.deleteOperation?.operation_id || mapping?.pending?.body.operation_id
  if (value) {
    const saved = JSON.parse(value) as SavedPolicy
    if (saved.version !== 1 || saved.contentId !== contentId || saved.authOrigin !== AUTH_BASE_URL.replace(/\/+$/, '') || !['local-only', 'sync'].includes(saved.mode))
      throw new Error('此内容同步选择的归属尚未核验，原记录保留')
    return { contentId, mode: saved.mode, authorization: 'explicit', pausedOperation }
  }
  // Mapping/cache existence alone is not permission. Preserve a previously
  // acknowledged sync only when its signature and original-service proof exist.
  const ack = state.serviceOrigin === integrationBaseUrl && !!mapping?.signature && mapping.revision > 0 &&
    !!state.cache[contentId] && state.cache[contentId].revision >= mapping.revision
  return { contentId, mode: ack ? 'sync' : mapping?.pending || mapping?.deleteOperation ? 'legacy-review' : 'local-only',
    authorization: ack ? 'legacy-ack' : 'none', pausedOperation }
}
export async function readItemSyncPolicy(note: Note | string, expectedOwner?: string): Promise<ItemSyncPolicy> {
  const owner = expectedOwner || await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const scope = identityScope(owner)
  const source = typeof note === 'string' ? await getNote(note, { expectedOwner: scope.owner }) : note
  assertIdentity(scope)
  const state = await readWorkspace(scope.owner)
  assertIdentity(scope)
  return policyForContent(scope.owner, canonicalContentId(source, state), state)
}
export async function setItemSyncPolicy(noteId: string, mode: 'local-only' | 'sync', expectedOwner: string): Promise<ItemSyncPolicy> {
  const scope = identityScope(expectedOwner)
  assertIdentity(scope)
  if (await readAccountId() !== expectedOwner) throw new Error('账号已切换')
  assertIdentity(scope)
  epoch++
  listeners.forEach(listener => listener())
  const source = await getNote(noteId, { expectedOwner }) // Fresh; never use a display projection for preservation.
  assertIdentity(scope)
  const state = await readWorkspace(expectedOwner)
  assertIdentity(scope)
  const contentId = canonicalContentId(source, state)
  // Preserve the current body locally before pausing a virtual cloud item. The
  // existing workspace snapshot retains only history actually read on this device.
  if (mode === 'local-only') {
    await Storage.setItem(`vinote:${expectedOwner}:note:${noteId}`, JSON.stringify({ ...source, id: noteId, content_id: contentId }))
    assertIdentity(scope)
  }
  // Stop in-flight writes before asynchronous persistence. UI updates only after
  // successful durable policy storage; failure retains the previous selection.
  await Storage.setItem(`${namespace(expectedOwner)}${contentId}`, JSON.stringify({ version: 1, contentId, mode, authOrigin: scope.authOrigin } satisfies SavedPolicy))
  assertIdentity(scope)
  changed()
  return { contentId, mode, authorization: 'explicit', pausedOperation: Object.values(state.mappings).find(row => row.key === contentId)?.pending?.body.operation_id }
}
