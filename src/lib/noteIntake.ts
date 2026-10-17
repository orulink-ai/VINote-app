import { ApiError } from './errors'
import Storage from '@react-native-async-storage/async-storage'
import { generationBaseUrl, integrationJson } from './integration'
import { readAccountId } from './storage'
import { saveSourceNote } from './notes'
import type { LocalFile } from './localFiles'
import type { LocalRecording } from '../features/recording/recordingLibrary'
import { advanceLocalFileAssociation, beginLocalFileAssociation, markLocalFileDispatch, readLocalFileAssociation } from './localFileAssociations'
import { isExplicitVideoUrl } from './intakeCapabilities'
import { type ModelSelection } from './models'
import { prepareClientNote, startClientNote, readClientNote } from './clientNotePipeline'

export type IntakeFile = LocalFile | LocalRecording
export type IntakeDraft = { execution?: 'client'; modelOrigin?: string; modelSelection?: ModelSelection; retryUncertain?: boolean; modelConfirmationRequired?: boolean; mode: 'url' | 'file'; url: string; file?: IntakeFile; taskId?: string; sourceType?: string; uncertain?: boolean; operationId?: string; receiptState?: 'unknown' | 'reserved' | 'accepted'; recoverySupported?: boolean; generationOrigin?: string; submittedAt?: string }
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
async function writeSlot(owner: string, draft: IntakeDraft) {
  await guard(owner)
  if (draft.operationId) await Storage.setItem(`vinote:${owner}:source-request:${draft.operationId}`, JSON.stringify(draft))
  await guard(owner)
  await Storage.setItem(key(owner), JSON.stringify(draft))
  await guard(owner)
}
const slotMutations = new Map<string, Promise<unknown>>()
async function mutateSlot<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const work = (slotMutations.get(owner) || Promise.resolve()).catch(() => {}).then(action)
  slotMutations.set(owner, work)
  try { return await work } finally { if (slotMutations.get(owner) === work) slotMutations.delete(owner) }
}
export async function writeIntake(owner: string, draft: IntakeDraft) {
  return mutateSlot(owner, () => writeSlot(owner, draft))
}
function selectionKey(draft: IntakeDraft) {
  const file = draft.file
  return JSON.stringify({ operation: draft.operationId, task: draft.taskId, execution: draft.execution,
    origin: draft.modelOrigin, extraction: draft.generationOrigin, mode: draft.mode, url: draft.url,
    models: draft.modelSelection,
    file: file ? { id: file.id, uri: file.uri, extension: file.extension, size: 'size' in file ? file.size : undefined,
      source: 'bilibiliSource' in file ? file.bilibiliSource : undefined } : undefined })
}
export async function leaveClientIntake(owner: string, expected: IntakeDraft) {
  return mutateSlot(owner, async () => {
    const stored = await readIntake(owner)
    if (expected.execution !== 'client' || !expected.operationId || selectionKey(stored) !== selectionKey(expected)) throw new Error('当前来源已变化，未清除新的输入')
    const record = await readClientNote(owner, expected)
    if (selectionKey(record.draft) !== selectionKey(expected)) throw new Error('原来源身份已变化，未清除当前输入')
    if (!['unknown', 'failed', 'success'].includes(record.status)) throw new Error('原处理仍在进行，请先读取原状态')
    // Archive only the exact selection. The independent client record, result,
    // source associations and inference markers are never changed by this action.
    await writeSlot(owner, stored)
    await writeSlot(owner, { mode: 'url', url: '' })
  })
}
export async function leaveReservedIntake(owner: string, expected: IntakeDraft) {
  const stored = await readIntake(owner)
  if (!expected.operationId || stored.receiptState !== 'reserved' || stored.operationId !== expected.operationId || stored.taskId !== expected.taskId || stored.generationOrigin !== expected.generationOrigin) throw new Error('原提交已变化，请重新核验后再整理其他内容')
  // Preserve the exact operation archive; never remove its original file association.
  await writeIntake(owner, stored)
  await writeIntake(owner, { mode: 'url', url: '' })
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
  if (draft.mode === 'url') {
    draft = { ...draft, url: intakeUrl(draft.url), sourceType: 'file' }
    if (isExplicitVideoUrl(draft.url)) throw new Error('视频请先在设备保存音频或导入原文件，再生成笔记；不会由公网服务请求模型')
  } else {
    if (!draft.file) throw new Error('请先选择文件')
    draft = { ...draft, sourceType: 'bilibiliSource' in draft.file && draft.file.bilibiliSource ? 'video' : intakeSourceType(draft.file) }
    const sourceOperation = 'bilibiliSource' in draft.file! ? draft.file!.bilibiliSource?.operationId : undefined
    if (sourceOperation) {
      const previous = await readLocalFileAssociation(owner, sourceOperation)
      if (previous) {
        const raw = await Storage.getItem(`vinote:${owner}:source-request:${sourceOperation}`)
        await guard(owner)
        if (!raw) throw new Error('原来源已有处理关联，请保留原操作核验；不会创建另一任务')
        return recoverIntake(owner, JSON.parse(raw))
      }
    }
  }
  const receipt = await prepareClientNote(owner, draft)
  if (receipt.file && 'name' in receipt.file) await beginLocalFileAssociation(owner, receipt.file, receipt.operationId!, { execution: 'client', modelOrigin: receipt.modelOrigin! })
  await writeIntake(owner, receipt)
  await markLocalFileDispatch(owner, receipt.operationId!)
  await advanceLocalFileAssociation(owner, receipt.operationId!, receipt.taskId!, 'accepted')
  // Only an explicit new submission starts work. Queries and old receipts never do.
  await startClientNote(owner, receipt)
  return receipt
}

export async function recoverIntake(owner: string, draft: IntakeDraft): Promise<IntakeDraft> {
  await guard(owner)
  assertIntakeOrigin(draft)
  if (draft.execution === 'client') { await readClientNote(owner, draft); return draft }
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
  if (draft.execution === 'client') {
    const record = await readClientNote(owner, draft)
    const checkpoint = record.transcription
    const progress = record.stage === 'asr' && checkpoint?.version === 5 && checkpoint.duration > 0
      ? Math.min(1, checkpoint.intervals.reduce((sum, part) => sum + part.end - part.start, 0) / checkpoint.duration) : undefined
    if (!record.result) return { status: { status: record.status, message: record.message, progress, retryable: record.retryable } as IntakeStatus }
    const note = await saveSourceNote(draft.taskId!, record.result.title, record.result.markdown, draft.sourceType || 'file', owner, draft.file?.createdAt || draft.submittedAt, draft.file && 'bilibiliSource' in draft.file ? draft.file.bilibiliSource : undefined)
    await guard(owner)
    if (draft.operationId) await advanceLocalFileAssociation(owner, draft.operationId, draft.taskId!, 'saved', note.id)
    await mutateSlot(owner, async () => {
      const current = await readIntake(owner)
      if (selectionKey(current) === selectionKey(draft)) await writeSlot(owner, { mode: draft.mode, url: '' })
    })
    return { status: { status: 'success', result: record.result } as IntakeStatus, note }
  }
  if (draft.receiptState === 'reserved' || draft.uncertain) throw new Error('提交已登记，尚未确认排队；请核验原提交，不重新派发')
  if (!draft.taskId) throw new Error('尚未收到任务编号，请检查提交状态')
  const status = await integrationJson<IntakeStatus>(`/api/task/${encodeURIComponent(draft.taskId)}`, {}, owner)
  await guard(owner)
  if (status.status === 'success' && !status.result?.markdown?.trim()) throw new Error('任务已结束，但未收到有效正文；请重新查询，不要重复提交')
  if (status.status === 'success' && status.result?.markdown?.trim()) {
    const note = await saveSourceNote(draft.taskId, status.result.title, status.result.markdown, draft.sourceType || 'video', owner, draft.file?.createdAt || draft.submittedAt,
      draft.file && 'bilibiliSource' in draft.file ? draft.file.bilibiliSource : undefined)
    await guard(owner)
    if (draft.operationId) await advanceLocalFileAssociation(owner, draft.operationId, draft.taskId, 'saved', note.id)
    // Clear only after local saving succeeds; a failed save keeps the accepted receipt.
    await mutateSlot(owner, async () => {
      const current = await readIntake(owner)
      if (selectionKey(current) === selectionKey(draft)) await writeSlot(owner, { mode: draft.mode, url: '' })
    })
    return { status, note }
  }
  return { status: { ...status, retryable: false } }
}
