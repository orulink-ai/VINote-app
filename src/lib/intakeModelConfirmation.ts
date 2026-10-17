import { generationBaseUrl, integrationJson } from './integration'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'
import { readIntake, type IntakeDraft } from './noteIntake'

export type IntakeModelSelection = { mode: 'cloud'; server_url: string; asr_model: string; llm_model: string }
export type IntakeModelContext = {
  task_id: string; source: { title: string; type: 'document' | 'media' }
  requires_confirmation: boolean; can_confirm?: boolean; selection?: IntakeModelSelection
}
export type IntakeModelBinding = { owner: string; epoch: number; taskId: string; operationId?: string; origin: string }
export function bindIntakeModel(owner: string, draft: IntakeDraft): IntakeModelBinding {
  if (draft.execution === 'client') throw new Error('设备笔记操作不能转为云任务恢复')
  if (!owner || !draft.taskId || !draft.generationOrigin || draft.generationOrigin !== generationBaseUrl || draft.uncertain || draft.receiptState === 'reserved') {
    throw new Error('原任务或处理服务尚未核验，请返回处理历史查询原任务。')
  }
  return { owner, epoch: identityEpoch(), taskId: draft.taskId, operationId: draft.operationId, origin: draft.generationOrigin }
}
export function guardIntakeModel(binding: IntakeModelBinding, draft: IntakeDraft) {
  if (identityEpoch() !== binding.epoch || generationBaseUrl !== binding.origin || draft.generationOrigin !== binding.origin ||
    draft.taskId !== binding.taskId || draft.operationId !== binding.operationId) throw new Error('账号或原任务已变化，请重新读取恢复信息。')
}
export async function verifyIntakeModel(binding: IntakeModelBinding, draft: IntakeDraft) {
  guardIntakeModel(binding, draft)
  if (await readAccountId() !== binding.owner) throw new Error('账号已切换，请重新打开原任务。')
  const stored = await readIntake(binding.owner)
  guardIntakeModel(binding, stored)
  if (stored.retryUncertain && !draft.retryUncertain) throw new Error('已有重试结果待确认，请只查询原任务。')
  if (await readAccountId() !== binding.owner) throw new Error('账号已切换，请重新打开原任务。')
  guardIntakeModel(binding, draft)
}
export function parseIntakeModelContext(value: unknown, taskId: string): IntakeModelContext {
  const data = value as IntakeModelContext | undefined
  if (!data || data.task_id !== taskId || typeof data.requires_confirmation !== 'boolean' || !data.source ||
    typeof data.source.title !== 'string' || !data.source.title.trim() || !['media', 'document'].includes(data.source.type)) throw new Error('恢复信息不完整，请重新读取原任务。')
  if (!data.requires_confirmation) return { task_id: taskId, source: { ...data.source }, requires_confirmation: false }
  const selection = data.selection
  if (typeof data.can_confirm !== 'boolean' || !selection || selection.mode !== 'cloud' ||
    ![selection.server_url, selection.asr_model, selection.llm_model].every(v => typeof v === 'string' && !!v.trim())) throw new Error('模型确认协议不完整，未允许重试。')
  let url: URL
  try { url = new URL(selection.server_url) } catch { throw new Error('模型服务来源无效，未允许重试。') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.host || url.username || url.password || url.search || url.hash) throw new Error('模型服务来源无效，未允许重试。')
  return { task_id: taskId, source: { ...data.source }, requires_confirmation: true, can_confirm: data.can_confirm,
    selection: { mode: 'cloud', server_url: selection.server_url, asr_model: selection.asr_model, llm_model: selection.llm_model } }
}
export async function readIntakeModelContext(binding: IntakeModelBinding, draft: IntakeDraft, live: () => void) {
  live(); await verifyIntakeModel(binding, draft); live()
  const value = await integrationJson<unknown>(`/api/task/${encodeURIComponent(binding.taskId)}/model-confirmation`, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } }, binding.owner, 45000, live)
  live(); await verifyIntakeModel(binding, draft); live()
  return parseIntakeModelContext(value, binding.taskId)
}
export function sameIntakeModelContext(a: IntakeModelContext, b: IntakeModelContext) {
  return a.task_id === b.task_id && a.requires_confirmation === b.requires_confirmation && a.can_confirm === b.can_confirm &&
    a.source.title === b.source.title && a.source.type === b.source.type &&
    a.selection?.mode === b.selection?.mode && a.selection?.server_url === b.selection?.server_url &&
    a.selection?.asr_model === b.selection?.asr_model && a.selection?.llm_model === b.selection?.llm_model
}
