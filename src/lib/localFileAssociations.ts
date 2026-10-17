import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { generationBaseUrl } from './integration'
import { readAccountId } from './storage'
import type { LocalFile } from './localFiles'

export type LocalFileAssociation = {
  owner: string; localFileId: string; operationId: string; generationOrigin: string
  taskId?: string; noteId?: string; state: 'prepared' | 'unknown' | 'reserved' | 'accepted' | 'saved'
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const prefix = (owner: string) => `vinote:${owner}:local-file-association:`
// Serialize only pending mutations, never cache account data or CAS snapshots.
const mutations = new Map<string, Promise<unknown>>()
async function serialize<T>(owner: string, operationId: string, action: () => Promise<T>): Promise<T> {
  const key = prefix(owner) + operationId
  const work = (mutations.get(key) || Promise.resolve()).catch(() => {}).then(action)
  mutations.set(key, work)
  try { return await work } finally { if (mutations.get(key) === work) mutations.delete(key) }
}
async function guard(owner: string) {
  if (!owner || await readAccountId() !== owner) throw new Error('账号已切换，原件关联未写入其他账号')
}
function checked(value: LocalFileAssociation, owner: string): LocalFileAssociation {
  if (!value || value.owner !== owner || !uuid.test(value.localFileId) || !uuid.test(value.operationId) || !value.generationOrigin ||
      !['prepared', 'unknown', 'reserved', 'accepted', 'saved'].includes(value.state) ||
      (value.taskId != null && !uuid.test(value.taskId)) ||
      (!['prepared', 'unknown'].includes(value.state) && !value.taskId) ||
      (value.noteId != null && value.noteId !== `source-${value.taskId}`) ||
      (value.state === 'saved' && !value.noteId)) throw new Error('原件关联记录不完整，请保留原任务核验')
  return value
}
export async function readLocalFileAssociation(owner: string, operationId: string) {
  await guard(owner)
  if (!uuid.test(operationId)) throw new Error('原提交编号无效')
  const value = await Storage.getItem(prefix(owner) + operationId)
  await guard(owner)
  if (!value) return undefined
  const record = checked(JSON.parse(value), owner)
  if (record.operationId !== operationId) throw new Error('原件关联与原提交不一致')
  return record
}
export async function beginLocalFileAssociation(owner: string, file: LocalFile, operationId: string) {
  return serialize(owner, operationId, () => begin(owner, file, operationId))
}
async function begin(owner: string, file: LocalFile, operationId: string) {
  await guard(owner)
  if (!generationBaseUrl || !uuid.test(operationId) || !uuid.test(file.id) || !/^[a-z0-9]{1,8}$/.test(file.extension) ||
      file.uri !== `file://${FS.DocumentDirectoryPath}/files/accounts/${encodeURIComponent(owner)}/${file.id}.${file.extension}`) throw new Error('原文件或内容处理服务未核验，不能登记关联')
  const existing = await readLocalFileAssociation(owner, operationId)
  if (existing) {
    if (existing.localFileId !== file.id || existing.generationOrigin !== generationBaseUrl) throw new Error('原提交已绑定另一来源或服务，不能替换')
    return existing
  }
  // Evidence is the actual imported file's metadata and nonempty binary; never
  // infer an old original from a note title, remote task id, or extraction text.
  const metadata = JSON.parse(await FS.readFile(`${FS.DocumentDirectoryPath}/files/accounts/${encodeURIComponent(owner)}/${file.id}.meta.json`, 'utf8')) as LocalFile
  await guard(owner)
  if (metadata.id !== file.id || metadata.uri !== file.uri || metadata.extension !== file.extension) throw new Error('原文件登记与所选来源不一致')
  const stat = await FS.stat(file.uri.replace('file://', ''))
  await guard(owner)
  if (!Number(stat.size) || Number(stat.size) !== metadata.size || Number(stat.size) !== file.size) throw new Error('原文件已变化，请重新选择来源')
  const record: LocalFileAssociation = { owner, localFileId: file.id, operationId, generationOrigin: generationBaseUrl, state: 'prepared' }
  await guard(owner)
  await Storage.setItem(prefix(owner) + operationId, JSON.stringify(record))
  await guard(owner)
  return record
}
export async function advanceLocalFileAssociation(owner: string, operationId: string, taskId: string, state: 'reserved' | 'accepted' | 'saved', noteId?: string) {
  return serialize(owner, operationId, () => advance(owner, operationId, taskId, state, noteId))
}
async function advance(owner: string, operationId: string, taskId: string, state: 'reserved' | 'accepted' | 'saved', noteId?: string) {
  const previous = await readLocalFileAssociation(owner, operationId)
  if (!previous) return // Legacy submissions have no verified local evidence.
  if (previous.generationOrigin !== generationBaseUrl || !uuid.test(taskId) || (previous.taskId && previous.taskId !== taskId)) throw new Error('原提交的服务或任务已变化，关联未替换')
  if (previous.state === 'saved') {
    if (noteId && previous.noteId !== noteId) throw new Error('原任务已关联另一笔记')
    return previous
  }
  if (state === 'saved') {
    if (noteId !== `source-${taskId}`) throw new Error('笔记与原任务不一致')
    const value = await Storage.getItem(`vinote:${owner}:note:${noteId}`)
    await guard(owner)
    const note = value ? JSON.parse(value) : undefined
    if (!note || note.id !== noteId || !note.content?.trim()) throw new Error('笔记尚未保存，原件关联与回执保留')
  }
  const next = checked({ ...previous, taskId, state: previous.state === 'accepted' && state === 'reserved' ? 'accepted' : state, ...(noteId ? { noteId } : {}) }, owner)
  await guard(owner)
  await Storage.setItem(prefix(owner) + operationId, JSON.stringify(next))
  await guard(owner)
  return next
}
export async function markLocalFileDispatch(owner: string, operationId: string) {
  return serialize(owner, operationId, async () => {
    const previous = await readLocalFileAssociation(owner, operationId)
    if (!previous) return
    if (previous.generationOrigin !== generationBaseUrl) throw new Error('原内容处理服务已变化')
    if (previous.state !== 'prepared') return previous
    const next: LocalFileAssociation = { ...previous, state: 'unknown' }
    await guard(owner)
    await Storage.setItem(prefix(owner) + operationId, JSON.stringify(next))
    await guard(owner)
    return next
  })
}
export async function listLocalFileAssociations(owner: string, localFileId: string): Promise<LocalFileAssociation[]> {
  await guard(owner)
  if (!uuid.test(localFileId)) throw new Error('原文件编号无效')
  const keys = (await Storage.getAllKeys()).filter(key => key.startsWith(prefix(owner)))
  await guard(owner)
  const values = await Promise.all(keys.map(async key => {
    const value = await Storage.getItem(key)
    if (!value) return undefined
    const record = checked(JSON.parse(value), owner)
    if (key !== prefix(owner) + record.operationId) throw new Error('原件关联索引不一致')
    return record
  }))
  await guard(owner)
  return values.filter((value): value is LocalFileAssociation => !!value && value.localFileId === localFileId)
}
