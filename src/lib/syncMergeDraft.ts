import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readAccountId } from './storage'
import { integrationBaseUrl } from './integration'
import type { WorkspaceMapping } from './workspaceStorage'

export type SyncMergeDraft = {
  owner: string; serviceOrigin: string; group: string; key: string; operationId: string
  comparedRevision: number; localRevision: number; title: string
  localContent: string; remoteContent: string; remoteDeleted: boolean; text: string
}
type Pointer = { file: string; previous?: string }
let writing: Promise<void> = Promise.resolve()
const pointerKey = (owner: string, operation: string) => `vinote:${owner}:sync-merge:${encodeURIComponent(integrationBaseUrl)}:${encodeURIComponent(operation)}`
const path = (file: string) => {
  if (!/^sync-merge-[a-zA-Z0-9%_.!~*'()-]+\.json$/.test(file)) throw new Error('合并草稿索引无效，请保留内容并重试')
  return `${FS.DocumentDirectoryPath}/${file}`
}
async function guard(owner: string) {
  if (!owner || await readAccountId() !== owner) throw new Error('账号已切换，原账号合并草稿不会迁移到当前账号')
}
function serial(job: () => Promise<void>) {
  const next = writing.catch(() => {}).then(job)
  writing = next
  return next
}
export function mergeDraftFor(owner: string, mapping: WorkspaceMapping): SyncMergeDraft {
  if (!mapping.pending || !mapping.conflict || mapping.status !== 'conflict') throw new Error('冲突状态已变化，请重新读取')
  return { owner, serviceOrigin: integrationBaseUrl, group: mapping.group, key: mapping.key,
    operationId: mapping.pending.body.operation_id, comparedRevision: mapping.conflict.revision,
    localRevision: mapping.pending.body.base_revision, title: mapping.pending.body.title,
    localContent: mapping.pending.body.content, remoteContent: mapping.conflict.content,
    remoteDeleted: mapping.conflict.deleted, text: mapping.pending.body.content }
}
export function mergeDraftMatches(draft: SyncMergeDraft, mapping?: WorkspaceMapping): boolean {
  return !!mapping && draft.serviceOrigin === integrationBaseUrl && mapping.key === draft.key && mapping.group === draft.group &&
    mapping.status === 'conflict' && mapping.pending?.body.operation_id === draft.operationId &&
    mapping.pending.body.content === draft.localContent && mapping.pending.body.base_revision === draft.localRevision &&
    mapping.conflict?.revision === draft.comparedRevision && mapping.conflict.content === draft.remoteContent &&
    mapping.conflict.deleted === draft.remoteDeleted
}
export async function readMergeDraft(owner: string, operation: string): Promise<SyncMergeDraft | null> {
  await writing.catch(() => {})
  await guard(owner)
  const raw = await Storage.getItem(pointerKey(owner, operation))
  if (!raw) return null
  const pointer = JSON.parse(raw) as Pointer
  const draft = JSON.parse(await FS.readFile(path(pointer.file), 'utf8')) as SyncMergeDraft
  await guard(owner)
  if (draft.owner !== owner || draft.operationId !== operation || draft.serviceOrigin !== integrationBaseUrl ||
      typeof draft.group !== 'string' || typeof draft.key !== 'string' || typeof draft.title !== 'string' ||
      !Number.isInteger(draft.comparedRevision) || !Number.isInteger(draft.localRevision) ||
      typeof draft.text !== 'string' || typeof draft.localContent !== 'string' || typeof draft.remoteContent !== 'string' || typeof draft.remoteDeleted !== 'boolean') {
    throw new Error('合并草稿无法核验，原记录已保留；请重试读取，不自动覆盖')
  }
  return draft
}
export function saveMergeDraft(draft: SyncMergeDraft): Promise<void> {
  return serial(async () => {
    await guard(draft.owner)
    if (draft.serviceOrigin !== integrationBaseUrl) throw new Error('共享服务已变化，合并草稿属于原服务，请返回原服务处理')
    const key = pointerKey(draft.owner, draft.operationId)
    const previous = JSON.parse(await Storage.getItem(key) || '{}') as Partial<Pointer>
    const file = `sync-merge-${encodeURIComponent(draft.owner)}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    // Keep full text out of SQLite; commit a small pointer only after the file exists.
    await FS.writeFile(path(file), JSON.stringify(draft), 'utf8')
    await guard(draft.owner)
    await Storage.setItem(key, JSON.stringify({ file, previous: previous.file }))
    if (previous.previous) await FS.unlink(path(previous.previous)).catch(() => {})
  })
}
export function removeMergeDraft(owner: string, operation: string): Promise<void> {
  return serial(async () => {
    await guard(owner)
    const key = pointerKey(owner, operation), raw = await Storage.getItem(key)
    if (!raw) return
    const pointer = JSON.parse(raw) as Pointer
    await guard(owner)
    await Storage.removeItem(key)
    await FS.unlink(path(pointer.file)).catch(() => {})
    if (pointer.previous) await FS.unlink(path(pointer.previous)).catch(() => {})
  })
}
