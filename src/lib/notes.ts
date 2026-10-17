import Storage from '@react-native-async-storage/async-storage'
import { ApiError } from './errors'
import { devReadSync as measureRead, devReadTiming as startRead, readAccountId, sessionRevision } from './storage'
import type { Note } from '../types/api'
import FS from 'react-native-fs'
import Share from 'react-native-share'
import { readWorkspace, readWorkspaceSnapshot, workspaceViews, workspaceNote, type WorkspaceState } from './workspaceStorage'
import { integrationBaseUrl, operationId } from './integration'
import { AUTH_BASE_URL } from '../config/env'
import { changed, writeWorkspace } from './workspaceStorage'
import { localLibrary } from './localLibrary'
import { recordingTitle, summaryTopic } from '../features/recording/recordingTitle'
// Partial storage mocks may omit optional development diagnostics.
const devReadTiming: typeof startRead = startRead ?? (() => () => {})
const devReadSync: typeof measureRead = measureRead ?? ((_stage, action) => action())
type ReadScope = { owner: string; generation: number; authOrigin: string; workspaceOrigin: string }
export type NoteReadOptions = { expectedOwner?: string; mode?: 'fresh' | 'display' }
const normalizeOrigin = (value: string | undefined) => (value || '').replace(/\/+$/, '')
const generationNow = () => sessionRevision?.() ?? 0
function assertReadScope(scope: ReadScope) {
  if (generationNow() !== scope.generation) throw new Error('账号已切换或会话已更新，请重新读取内容')
  if (normalizeOrigin(AUTH_BASE_URL) !== scope.authOrigin || normalizeOrigin(integrationBaseUrl) !== scope.workspaceOrigin)
    throw new Error('服务已切换，请重新读取内容')
}
async function checkReadScope(scope: ReadScope) {
  assertReadScope(scope)
  const owner = await readAccountId()
  assertReadScope(scope)
  if (owner !== scope.owner) throw new Error('账号已切换，请重新读取内容')
}
async function captureReadScope(expectedOwner?: string): Promise<ReadScope> {
  const generation = generationNow(), authOrigin = normalizeOrigin(AUTH_BASE_URL), workspaceOrigin = normalizeOrigin(integrationBaseUrl)
  const owner = await readAccountId()
  if (expectedOwner && owner !== expectedOwner) throw new Error('账号已切换，请重新读取内容')
  if (!owner) throw new ApiError('请重新登录', 401)
  const scope = { owner, generation, authOrigin, workspaceOrigin }
  assertReadScope(scope)
  return scope
}
function currentServiceView(state: WorkspaceState, origin = normalizeOrigin(integrationBaseUrl)): WorkspaceState {
  if (state.localOnly) return state
  // Preserve old-service storage/baselines for migration, but do not render them
  // as this service's remote content. Device-local notes remain available.
  return !verifiedWorkspaceOrigin(state, origin)
    ? { ...state, mappings: {}, cache: {} } : state
}
function verifiedWorkspaceOrigin(state: WorkspaceState, origin = normalizeOrigin(integrationBaseUrl)) {
  if (state.localOnly) return true
  return !!state.serviceOrigin && !!origin && normalizeOrigin(state.serviceOrigin) === origin
}
function unverifiedWorkspaceOrigin() {
  return new ApiError('共享正文的服务来源尚未核验，请返回原服务或完成同步核验后再查看；本机正文与原缓存仍保留。',
    409, { code: 'WORKSPACE_ORIGIN_UNVERIFIED' })
}

// Display only: serialized single Notes, never mutable WorkspaceState or CAS data.
// Budget includes key, exact local value and Note JSON as UTF-16 payload bytes;
// bounded entry overhead is additional. Oversized notes simply bypass this cache.
const DISPLAY_MAX_ENTRIES = 16, DISPLAY_MAX_BYTES = 4 * 1024 * 1024
type DisplayEntry = { localValue: string | null; json: string; bytes: number }
const displayNotes = new Map<string, DisplayEntry>()
let displayScope = '', displayBytes = 0
function scopeKey(scope: ReadScope) { return JSON.stringify([scope.owner, scope.generation, scope.authOrigin, scope.workspaceOrigin]) }
function displayKey(scope: ReadScope, pointer: string, id: string) {
  const key = scopeKey(scope)
  if (displayScope !== key) { displayNotes.clear(); displayBytes = 0; displayScope = key }
  return JSON.stringify([key, pointer, id])
}
function removeDisplay(key: string) {
  const old = displayNotes.get(key)
  if (old) { displayBytes -= old.bytes; displayNotes.delete(key) }
}
function cachedDisplay(scope: ReadScope, pointer: string | null, id: string, localValue: string | null): Note | undefined {
  if (!pointer) return undefined
  const key = displayKey(scope, pointer, id), entry = displayNotes.get(key)
  if (!entry) return undefined
  if (entry.localValue !== localValue) { removeDisplay(key); return undefined }
  displayNotes.delete(key); displayNotes.set(key, entry)
  return JSON.parse(entry.json) as Note // Every caller receives its own nested objects.
}
function warmDisplay(scope: ReadScope, pointer: string | null, id: string, localValue: string | null, note: Note) {
  assertReadScope(scope)
  if (!pointer) return // Legacy mutable snapshots have no safe cache stamp.
  const key = displayKey(scope, pointer, id), json = JSON.stringify(note)
  const bytes = (key.length + (localValue?.length || 0) + json.length) * 2
  removeDisplay(key)
  if (bytes > DISPLAY_MAX_BYTES) return
  while (displayNotes.size >= DISPLAY_MAX_ENTRIES || displayBytes + bytes > DISPLAY_MAX_BYTES) {
    removeDisplay(displayNotes.keys().next().value!)
  }
  displayNotes.set(key, { localValue, json, bytes }); displayBytes += bytes
}
async function prefix() {
  const account = await readAccountId()
  if (!account) throw new ApiError('请重新登录', 401)
  return `vinote:${account}:note:`
}
async function listOwner(expectedOwner?: string) {
  const owner = expectedOwner ?? await readAccountId()
  if (!owner) throw new ApiError('请重新登录', 401)
  await checkListOwner(owner)
  return owner
}
async function checkListOwner(owner: string) {
  if (await readAccountId() !== owner) throw new Error('账号已切换，请重新加载内容列表')
}
export async function listLocalNotes(expectedOwner?: string): Promise<Note[]> {
  const owner = await listOwner(expectedOwner)
  const start = `vinote:${owner}:note:`
  const keys = (await Storage.getAllKeys()).filter(key => key.startsWith(start))
  await checkListOwner(owner)
  const rows = await Promise.all(keys.map(async key => [key, await Storage.getItem(key)] as const))
  await checkListOwner(owner)
  return rows.filter(([, value]) => !!value).map(([, value]) => JSON.parse(value!) as Note).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
export async function listNotes(expectedOwner?: string): Promise<Note[]> {
  const scope = await captureReadScope(expectedOwner), owner = scope.owner
  // One owner-bound snapshot per load; no network wait or reusable CAS cache.
  await localLibrary(owner)
  const [local, saved] = await Promise.all([listLocalNotes(owner), readWorkspaceSnapshot(owner)])
  await checkReadScope(scope)
  const snapshot = currentServiceView(saved.state, scope.workspaceOrigin)
  const rows = await workspaceViews(local, snapshot), grouped = new Map<string, Note>()
  await checkReadScope(scope)
  for (const note of rows) {
    const key = note.workspace_key || note.content_id || note.id
    const current = grouped.get(key)
    if (!current || (note.version || 1) > (current.version || 1) || ((note.version || 1) === (current.version || 1) && note.updated_at > current.updated_at)) grouped.set(key, note)
  }
  const result = [...grouped.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  if (!result.length && !verifiedWorkspaceOrigin(saved.state, scope.workspaceOrigin) && Object.keys(saved.state.cache).length)
    throw unverifiedWorkspaceOrigin() // Unknown provenance is not an acknowledged empty library.
  // Only warm the bounded, newest visible projections if their exact immutable
  // snapshot is still committed. Lists themselves always read a fresh snapshot.
  if (saved.pointer) {
    const pointer = await Storage.getItem(`vinote:${owner}:workspace-file`)
    await checkReadScope(scope)
    if (pointer === saved.pointer) {
      for (const row of result.slice(0, DISPLAY_MAX_ENTRIES).reverse()) {
        const source = local.find(note => note.id === row.id)
        const value = source ? JSON.stringify(source) : null
        warmDisplay(scope, pointer, row.id, value, resolveNote(row.id, value, snapshot))
      }
    }
  }
  assertReadScope(scope)
  return result
}
export async function getNote(id: string, options: NoteReadOptions = {}): Promise<Note> {
  const total = devReadTiming('note.total')
  let step = devReadTiming('note.prefix')
  try {
    const scope = await captureReadScope(options.expectedOwner)
    const namespace = `vinote:${scope.owner}:note:`
    step()
    step = devReadTiming('note.local_read')
    let value = await Storage.getItem(`${namespace}${id}`)
    step(value ? 'ok' : 'empty')
    await checkReadScope(scope)
    step = devReadTiming('note.workspace')
    if (options.mode === 'display') {
      const pointerKey = `vinote:${scope.owner}:workspace-file`
      const pointer = await Storage.getItem(pointerKey)
      await checkReadScope(scope)
      const cached = cachedDisplay(scope, pointer, id, value)
      if (cached) { step(); total(); return cached }
      // Concurrent writes may change the pointer while a file crosses the native
      // bridge. Never stamp that old body with a separately read newer pointer.
      for (let retry = 0; retry < 2; retry++) {
        const saved = await readWorkspaceSnapshot(scope.owner)
        await checkReadScope(scope)
        const [latest, latestLocal] = await Promise.all([Storage.getItem(pointerKey), Storage.getItem(`${namespace}${id}`)])
        await checkReadScope(scope)
        if (latest !== saved.pointer || latestLocal !== value) { value = latestLocal; continue }
        if (!saved.state.localOnly && (Object.keys(saved.state.cache).length || Object.keys(saved.state.mappings).length)) { await localLibrary(scope.owner); continue }
        const note = devReadSync('note.resolve', () => resolveNote(id, value, { ...saved.state, localOnly: true }))
        warmDisplay(scope, saved.pointer, id, value, note)
        step(); total(); return note
      }
      throw new Error('正文缓存已更新，请重新读取；原内容仍保留')
    }
    const state = await localLibrary(scope.owner)
    await checkReadScope(scope)
    step()
    const note = devReadSync('note.resolve', () => resolveNote(id, value, state))
    assertReadScope(scope)
    total(); return note
  } catch (cause) { step('failed'); total('failed'); throw cause }
}
function resolveNote(id: string, value: string | null, state: WorkspaceState): Note {
  if (state.localOnly) {
    const local = value ? JSON.parse(value) as Note : undefined
    const mapping = Object.values(state.mappings).find(row => row.localIds.includes(id))
    const row = state.cache[local?.workspace_key || mapping?.key || id.replace(/^workspace-/, '')]
    if (local) {
      if (row?.deleted) return { ...local, deleted: true }
      const baseline = row?.versions.find(version => version.id === `retained-${row.key}`)
      if (!local.deleted && row && mapping?.pending && baseline?.content === local.content && row.content !== local.content)
        return { ...workspaceNote(row, mapping), id: local.id, content_id: local.content_id || row.key, task_id: local.task_id }
      return local
    }
    if (row) return workspaceNote(row, mapping)
    throw new ApiError('尚未保存这份内容，请检查文件或处理记录', 404)
  }
  const verified = verifiedWorkspaceOrigin(state)
  const originalKey = Object.values(state.mappings).find(map => map.localIds.includes(id))?.key || id.replace(/^workspace-/, '')
  const unverifiedRemote = !verified && !!state.cache[originalKey]
  state = currentServiceView(state)
  const sourceMapping = Object.values(state.mappings).find(map => map.localIds.includes(id))
  const remote = state.cache[sourceMapping?.key || id.replace(/^workspace-/, '')]
  const local = value ? devReadSync('note.parse', () => JSON.parse(value) as Note) : undefined
  const mapping = Object.values(state.mappings).find(map => map.key === remote?.key)
  if (remote && !remote.deleted && !mapping?.pending && mapping?.status !== 'conflict' && (!local || local.updated_at <= remote.updated_at)) return workspaceNote(remote, mapping)
  if (local) return local
  if (unverifiedRemote) throw unverifiedWorkspaceOrigin()
  throw new ApiError('本机未缓存这份内容，请同步后重试', 404)
}
export async function archiveNote(id: string, archived: boolean) {
  const namespace = await prefix(), note = await getNote(id)
  if (namespace !== await prefix()) throw new Error('账号已切换')
  const next = { ...note, archived, updated_at: new Date().toISOString() }
  await Storage.setItem(`${namespace}${id}`, JSON.stringify(next)); changed(); return next
}
export async function classifyNote(id: string, project: string, tags: string[]) {
  if (project.length > 120 || tags.length > 30 || tags.some(tag => tag.length > 80)) throw new Error('项目不超过120字，标签最多30个且每项不超过80字')
  const namespace = await prefix(), note = await getNote(id)
  if (namespace !== await prefix()) throw new Error('账号已切换')
  const next = { ...note, project: project.trim(), tags: [...new Set(tags.map(tag => tag.trim()).filter(Boolean))], updated_at: new Date().toISOString() }
  await Storage.setItem(`${namespace}${id}`, JSON.stringify(next)); changed(); return next
}
export async function renameNote(id: string, title: string) {
  const key = `${await prefix()}${id}`
  if (!title.trim() || title.trim().length > 120) throw new Error('请输入 1–120 字的会议名称')
  const note = { ...await getNote(id), title: title.trim(), updated_at: new Date().toISOString() }
  await Storage.setItem(key, JSON.stringify(note))
  changed()
  return note
}
export async function deleteNote(id: string) {
  return setNoteDeleted(id, true)
}
export async function setNoteDeleted(id: string, deleted: boolean, expectedOwner?: string) {
  const scope = await captureReadScope(expectedOwner), owner = scope.owner, namespace = `vinote:${owner}:note:`
  const state = await localLibrary(owner)
  await checkReadScope(scope)
  const value = await Storage.getItem(`${namespace}${id}`)
  await checkReadScope(scope)
  const note = resolveNote(id, value, state)
  const locals = await listLocalNotes(owner)
  const originalMapping = Object.values(state.mappings).find(row => row.localIds.includes(id) || row.key === note.workspace_key)
  for (const row of [note, ...locals.filter(row => row.id !== note.id && ((row.content_id && row.content_id === note.content_id) || originalMapping?.localIds.includes(row.id)))]) {
    await checkReadScope(scope)
    await Storage.setItem(`${namespace}${row.id}`, JSON.stringify({ ...row, deleted }))
  }
  const mapping = originalMapping
  const key = note.workspace_key || mapping?.key
  if (key && state.cache[key]) {
    state.cache[key].deleted = deleted
    await checkReadScope(scope)
    await writeWorkspace(owner, state, () => assertReadScope(scope))
  }
  await checkReadScope(scope); changed()
}
export async function listDeletedNotes(expectedOwner?: string): Promise<Note[]> {
  const scope = await captureReadScope(expectedOwner), state = await localLibrary(scope.owner)
  const locals = await listLocalNotes(scope.owner)
  await checkReadScope(scope)
  const rows = locals.filter(note => note.deleted)
  for (const row of Object.values(state.cache)) if (row.deleted && !rows.some(note => note.workspace_key === row.key)) rows.push(workspaceNote(row))
  return rows
}
export type NoteRevision = { content: string; savedAt: string }
export async function noteRevisions(id: string): Promise<NoteRevision[]> {
  return JSON.parse(await Storage.getItem(`${(await prefix()).replace(':note:', ':note-history:')}${id}`) || '[]')
}
export async function editNoteContent(id: string, content: string, baseline?: Pick<Note, 'content' | 'workspace_revision'>, expectedOwner?: string) {
  if (!content.trim()) throw new Error('纪要正文不能为空')
  const owner = expectedOwner ?? await readAccountId()
  if (!owner) throw new ApiError('请重新登录', 401)
  // Bind every read/write to the intent's owner, even when another account has
  // an identical note id and baseline. Never rebuild this namespace after awaits.
  const namespace = `vinote:${owner}:note:`
  const guard = async () => {
    if (await readAccountId() !== owner) throw new Error('账号已切换，修改未保存到其他账号')
  }
  await guard()
  const value = await Storage.getItem(`${namespace}${id}`)
  await guard()
  const state = await localLibrary(owner)
  await guard()
  const note = resolveNote(id, value, state)
  if (baseline && (baseline.content !== note.content || baseline.workspace_revision !== note.workspace_revision)) throw new Error('正文已有新修订。你的草稿已保留，请先比较最新正文，或另存为笔记。')
  const historyValue = await Storage.getItem(`${namespace.replace(':note:', ':note-history:')}${id}`)
  await guard()
  const history: NoteRevision[] = JSON.parse(historyValue || '[]')
  if (note.content !== content) history.push({ content: note.content, savedAt: note.updated_at })
  const next = { ...note, content, updated_at: new Date().toISOString() }
  // Save history first. If the current-note write fails, the original is still readable.
  await guard()
  await Storage.setItem(`${namespace.replace(':note:', ':note-history:')}${id}`, JSON.stringify(history))
  await guard()
  await Storage.setItem(`${namespace}${id}`, JSON.stringify(next))
  await guard()
  changed()
  return next
}
export async function nextNoteVersion(taskId: string) {
  const versions = (await listLocalNotes()).filter(note => note.task_id === taskId).map(note => note.version || 1)
  return Math.max(0, ...versions) + 1
}
export function noteIdForVersion(taskId: string, version: number) {
  return `app-${taskId}${version === 1 ? '' : `-v${version}`}`
}
export async function createNote(payload: { title: string; content: string; task_id: string }, owner?: string, version?: number) {
  const namespace = await prefix()
  if (owner && namespace !== `vinote:${owner}:note:`) throw new Error('账号已切换，纪要未保存到其他账号')
  const number = version ?? await nextNoteVersion(payload.task_id)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('纪要版本号无效')
  const now = new Date().toISOString()
  const previous = (await listLocalNotes(owner)).find(row => row.task_id === payload.task_id)
  const note: Note = { ...payload, id: noteIdForVersion(payload.task_id, number), version: number,
    content_id: previous?.workspace_key || previous?.content_id || (previous ? `mobile-${previous.id}` : operationId()),
    source_type: 'meeting_recording', generation_client: 'mobile', status: 'done', created_at: now, updated_at: now }
  const key = `${namespace}${note.id}`
  if (await Storage.getItem(key)) throw new Error(`版本 ${number} 的纪要已存在，请刷新录音库后重试`)
  await Storage.setItem(key, JSON.stringify(note))
  changed()
  return note
}
export async function createTextNote(title: string, content: string, taskId = `text-${operationId()}`, expectedOwner?: string) {
  if (!title.trim() || !content.trim()) throw new Error('请填写标题与正文')
  const scope = await captureReadScope(expectedOwner), namespace = `vinote:${scope.owner}:note:`, now = new Date().toISOString()
  const note: Note = { id: taskId, content_id: operationId(), title: title.trim(), content, source_type: 'text', generation_client: 'mobile', status: 'done', version: 1, created_at: now, updated_at: now }
  const existing = await Storage.getItem(`${namespace}${taskId}`)
  await checkReadScope(scope)
  if (existing) return JSON.parse(existing) as Note
  await Storage.setItem(`${namespace}${taskId}`, JSON.stringify(note))
  await checkReadScope(scope)
  changed()
  return note
}
export async function saveSourceNote(taskId: string, title: string, content: string, sourceType: string, owner: string, sourceCreatedAt?: string) {
  const namespace = await prefix()
  if (namespace !== `vinote:${owner}:note:`) throw new Error('账号已切换，结果仍保留在原任务中')
  if (!content.trim()) throw new Error('未收到有效笔记正文，请重新查询原任务')
  const id = `source-${taskId}`, key = `${namespace}${id}`
  const existing = await Storage.getItem(key)
  if (existing) return JSON.parse(existing) as Note
  const now = new Date().toISOString()
  // A remote task is not a local recording ID and must not grant local playback.
  const note: Note = { id, content_id: operationId(), title: recordingTitle(sourceCreatedAt || '', summaryTopic(content) || title.trim() || '总结笔记'), content, source_type: ['transcript', 'document'].includes(sourceType) ? 'file' : sourceType,
    generation_client: 'mobile', status: 'done', version: 1, created_at: now, updated_at: now }
  await Storage.setItem(key, JSON.stringify(note))
  changed()
  return note
}
export const exportNoteFile = (note: Note, publicationSnapshot = false) => shareNoteFile(note, true, publicationSnapshot)
export async function shareNoteFile(note: Note, exportFile = false, publicationSnapshot = false) {
  const safeTitle = note.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || '会议纪要'
  const directory = `${FS.CachesDirectoryPath}/vinote-share-${note.id}`
  const fileVersion = publicationSnapshot ? '发布正文快照' : `v${note.version || 1}`
  const versionLabel = publicationSnapshot ? '发布正文快照' : `版本 ${note.version || 1}`
  const path = `${directory}/${safeTitle}_${fileVersion}.md`
  await FS.mkdir(directory)
  await FS.writeFile(path, note.content, 'utf8')
  // Share.open may resolve before the receiving app reads the file.
  await Share.open({ url: `file://${path}`, type: 'text/markdown', title: `分享${safeTitle}（${versionLabel}）`, failOnCancel: false, saveToFiles: exportFile })
}
