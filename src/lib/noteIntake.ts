import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { generationBaseUrl, integrationJson, operationId, verifyContentService } from './integration'
import { ApiError } from './errors'
import { readAccountId } from './storage'
import { saveSourceNote } from './notes'
import type { LocalFile } from './localFiles'
import type { LocalRecording } from '../features/recording/recordingLibrary'
import { advanceLocalFileAssociation, beginLocalFileAssociation, markLocalFileDispatch } from './localFileAssociations'
import { isBilibiliUrl, isExplicitVideoUrl, isVideoUrlAllowed, videoUrlUnavailableMessage } from './intakeCapabilities'

export type IntakeFile = LocalFile | LocalRecording
export type IntakeDraft = { retryUncertain?: boolean; modelConfirmationRequired?: boolean; mode: 'url' | 'file'; url: string; file?: IntakeFile; taskId?: string; sourceType?: string; uncertain?: boolean; operationId?: string; receiptState?: 'unknown' | 'reserved' | 'accepted'; recoverySupported?: boolean; generationOrigin?: string; submittedAt?: string }
type SourceReceipt = { operation_id: string; task_id: string; state: 'reserved' | 'accepted'; status: string; source_type?: string }
export type IntakeStatus = { status: string; message?: string; progress?: number | null; retryable?: boolean; result?: { title: string; markdown: string } }
const key = (owner: string) => `vinote:${owner}:note-intake`
async function guard(owner: string) { if (owner !== await readAccountId()) throw new Error('账号已切换，请重新打开笔记') }
export function assertIntakeOrigin(draft: IntakeDraft) {
  if (draft.generationOrigin && draft.generationOrigin !== generationBaseUrl) throw new Error('原内容处理服务已变化，请保留原提交；不会跨服务查询或重新提交')
}
export async function readIntake(owner: string): Promise<IntakeDraft> {
  await guard(owner)
  return JSON.parse(await Storage.getItem(key(owner)) || '{"mode":"url","url":""}')
}
export async function writeIntake(owner: string, draft: IntakeDraft) {
  await guard(owner)
  if (draft.operationId) await Storage.setItem(`vinote:${owner}:source-request:${draft.operationId}`, JSON.stringify(draft))
  await guard(owner)
  await Storage.setItem(key(owner), JSON.stringify(draft))
  await guard(owner)
}
export function intakeFileName(file: IntakeFile) { return 'name' in file ? file.name : file.originalName || file.title + '.' + (file.extension || 'm4a') }
export function intakeSourceType(file: IntakeFile) {
  const extension = file.extension || 'm4a'
  if (['pdf', 'docx'].includes(extension)) return 'document'
  if (['txt', 'md', 'srt', 'vtt', 'json'].includes(extension)) return 'transcript'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension)) return 'video'
  if (['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus'].includes(extension)) return 'audio'
  throw new Error('支持 PDF、Word DOCX、音视频和文字文件；旧版 DOC 请另存为 DOCX。')
}
export function intakeUrl(value: string) {
  const match = value.trim().match(/https?:\/\/[^\s<>"，。]+/i)
  if (!match) throw new Error('请粘贴完整的 http 或 https 网页或视频链接')
  const url = new URL(match[0])
  if (url.username || url.password) throw new Error('链接不能包含账号密码')
  return url.href
}
const submissions = new Map<string, Promise<IntakeDraft>>()
export async function submitIntake(owner: string, draft: IntakeDraft): Promise<IntakeDraft> {
  await guard(owner)
  const active = submissions.get(owner)
  if (active) return active
  const work = submitSource(owner, draft).finally(() => submissions.delete(owner))
  submissions.set(owner, work)
  return work
}
async function submitSource(owner: string, draft: IntakeDraft): Promise<IntakeDraft> {
  await guard(owner)
  const stored = await readIntake(owner)
  // A stale screen cannot replace a durable request or change its input/options.
  if (stored.operationId) draft = stored
  assertIntakeOrigin(draft)
  if (draft.taskId && draft.receiptState !== 'reserved') return draft
  if (draft.operationId || draft.uncertain) return recoverIntake(owner, draft)
  if (!generationBaseUrl) throw new Error('当前内容处理服务尚未配置；原文件保留在此设备')
  const service = await verifyContentService(owner)
  await guard(owner)
  let body: string | FormData, path: string, sourceType: string
  if (draft.mode === 'url') {
    const url = intakeUrl(draft.url)
    if (isExplicitVideoUrl(url) && !isVideoUrlAllowed(url, service)) throw new Error(videoUrlUnavailableMessage(service))
    if (service.video_source_preflight === 1 && isBilibiliUrl(url)) {
      // Read-only source validation: no operation identity or generation work.
      await integrationJson('/api/content-service/video-source', { method: 'POST', body: JSON.stringify({ url }) }, owner, 60000)
      await guard(owner)
    }
    body = JSON.stringify({ video_url: url, platform: 'auto', workflow: 'note_organization', style: 'detailed', summary_mode: 'default', output_language: 'zh-CN' })
    path = '/api/generate'; sourceType = 'video'
  } else {
    if (!draft.file) throw new Error('请先选择文件')
    sourceType = intakeSourceType(draft.file)
    const file = draft.file, extension = file.extension || 'm4a'
    const folder = 'name' in file ? 'files' : 'recordings'
    const expected = `file://${FS.DocumentDirectoryPath}/${folder}/accounts/${encodeURIComponent(owner)}/${file.id}.${extension}`
    if (!/^[a-zA-Z0-9-]+$/.test(file.id) || file.uri !== expected) throw new Error('文件不属于当前账号，请重新选择')
    const stat = await FS.stat(file.uri.replace('file://', ''))
    const limit = Math.min(service.max_upload_bytes, sourceType === 'document' ? 20 * 1024 * 1024 : Infinity)
    if (!Number.isFinite(Number(stat.size)) || Number(stat.size) <= 0) throw new Error('请选择非空文件')
    if (Number(stat.size) > limit) throw new Error(`当前文件超过服务上限（${Math.floor(limit / 1024 / 1024)} MB），请另选文件；原文件保留在文件库。`)
    const form = new FormData()
    form.append('file', { uri: draft.file.uri, name: intakeFileName(draft.file), type: sourceType === 'document' ? (extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') : sourceType === 'transcript' ? 'text/plain' : sourceType === 'video' ? 'video/mp4' : 'audio/mp4' } as unknown as Blob)
    form.append('source_type', sourceType); form.append('title', intakeFileName(draft.file))
    form.append('style', 'detailed'); form.append('workflow', 'note_organization')
    form.append('summary_mode', 'default'); form.append('output_language', 'zh-CN')
    body = form; path = '/api/generate_from_upload'
  }
  const pending: IntakeDraft = { ...draft, submittedAt: new Date().toISOString(), sourceType: sourceType === 'document' ? 'file' : sourceType, operationId: operationId(), generationOrigin: generationBaseUrl, receiptState: 'unknown', uncertain: true }
  if (pending.mode === 'file' && pending.file && 'name' in pending.file) await beginLocalFileAssociation(owner, pending.file, pending.operationId!)
  // Fail closed on local persistence failure: do not dispatch an unprotected POST.
  await writeIntake(owner, pending)
  await guard(owner)
  await markLocalFileDispatch(owner, pending.operationId!)
  let response: { task_id: string; source_type?: string; state?: 'reserved' | 'accepted'; operation_id?: string }
  try { response = await integrationJson<typeof response>(path, { method: 'POST', body, headers: { 'X-VINote-Operation-Id': pending.operationId! } }, owner, 180000) }
  catch (cause) {
    // A rejection may happen after reservation. Keep the operation even on 4xx.
    await guard(owner)
    throw cause
  }
  await guard(owner)
  if (!/^[a-f0-9-]{36}$/.test(response.task_id)) throw new Error('服务未返回有效任务编号，请保留当前来源')
  if (response.operation_id && response.operation_id !== pending.operationId) throw new Error('服务回执与原提交不一致，请核验原操作')
  if (response.state && !['reserved', 'accepted'].includes(response.state)) throw new Error('服务回执状态无效，原操作保留，请继续核验')
  const receipt: IntakeDraft = { ...pending, taskId: response.task_id, sourceType: response.source_type || pending.sourceType, receiptState: response.state || 'accepted', uncertain: response.state === 'reserved', recoverySupported: !!response.state }
  // The screen retains this receipt even if its local persistence fails.
  await writeIntake(owner, receipt).catch(() => {})
  if (receipt.operationId && receipt.taskId) await advanceLocalFileAssociation(owner, receipt.operationId, receipt.taskId, response.state || 'accepted')
  return receipt
}
export async function recoverIntake(owner: string, draft: IntakeDraft): Promise<IntakeDraft> {
  await guard(owner)
  assertIntakeOrigin(draft)
  if (!draft.operationId) throw new Error('旧提交没有操作编号，无法核验未知结果；原来源保留，请勿重复提交')
  let response: SourceReceipt
  try { response = await integrationJson<SourceReceipt>(`/api/source-requests/${encodeURIComponent(draft.operationId)}`, {}, owner) }
  catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) throw new Error('尚未查到原提交回执，操作编号与来源已保留，请稍后核验。视频、音频与逐字稿尚未支持提交去重，不能自动重新提交。')
    throw cause
  }
  await guard(owner)
  if (response.operation_id !== draft.operationId || !/^[a-f0-9-]{36}$/.test(response.task_id) || !['reserved', 'accepted'].includes(response.state)) throw new Error('回执无效，原操作保留，请继续核验')
  const receipt: IntakeDraft = { ...draft, taskId: response.task_id, receiptState: response.state, sourceType: response.source_type || draft.sourceType, uncertain: response.state !== 'accepted', recoverySupported: true }
  await writeIntake(owner, receipt)
  await advanceLocalFileAssociation(owner, draft.operationId, response.task_id, response.state)
  return receipt
}
export async function inspectIntake(owner: string, draft: IntakeDraft) {
  await guard(owner)
  assertIntakeOrigin(draft)
  if (draft.receiptState === 'reserved' || draft.uncertain) throw new Error('提交已登记，尚未确认排队；请核验原提交，不重新派发')
  if (!draft.taskId) throw new Error('尚未收到任务编号，请检查提交状态')
  const status = await integrationJson<IntakeStatus>(`/api/task/${encodeURIComponent(draft.taskId)}`, {}, owner)
  await guard(owner)
  if (status.status === 'success' && !status.result?.markdown?.trim()) throw new Error('任务已结束，但未收到有效正文；请重新查询，不要重复提交')
  if (status.status === 'success' && status.result?.markdown?.trim()) {
    const note = await saveSourceNote(draft.taskId, status.result.title, status.result.markdown, draft.sourceType || 'video', owner, draft.file?.createdAt || draft.submittedAt)
    await guard(owner)
    if (draft.operationId) await advanceLocalFileAssociation(owner, draft.operationId, draft.taskId, 'saved', note.id)
    // Clear only after local saving succeeds; a failed save keeps the accepted receipt.
    await writeIntake(owner, { mode: draft.mode, url: '' })
    return { status, note }
  }
  return { status }
}
