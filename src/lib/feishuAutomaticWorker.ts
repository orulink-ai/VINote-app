import { readFeishuAutomatic } from './feishuAutomaticQueue'
import { readPublishDraft, queryPublishReceipt, newPublishDraft, persistPublishDraft, beginPublishAttempt, restoreUndispatchedPublish } from './feishuPublishReceipt'
import { readFeishuAutoConsent } from './feishuAutoConsent'
import { readFeishuLocalPreferences } from './feishuLocalPreferences'
import { feishuApi, publishToFeishu, newSnapshotPublishOptions, assertFeishuPublishReady, type FeishuStatus } from './feishu'
import { publishOptionsSignature, reviewPublishOptions } from './feishuPublishReview'
import { getNote } from './notes'
import { withFeishuAutoLock } from './feishuAutoMutex'
import { validateDevicePayload } from './feishuDevicePayload'

/** Recovery is read-only once the operation may have reached the server. */
export function processFeishuAutomatic(owner: string, noteId: string): Promise<void> {
  return withFeishuAutoLock(() => process(owner, noteId))
}
async function process(owner: string, noteId: string): Promise<void> {
  const intent = await readFeishuAutomatic(owner, noteId)
  if (!intent) return
  let draft = await readPublishDraft(owner, noteId)
  if (draft && draft.operationId !== intent.operationId) throw new Error('该纪要已有另一笔发布，请先核对原记录')
  if (draft && draft.state !== 'draft') {
    if (draft.jobStatusVerified && (draft.jobStatus === 'completed' || draft.jobStatus === 'failed' || draft.jobStatus === 'cancelled')) return
    if (draft.state === 'unknown') {
      const original = await feishuApi<{ state: 'accepted' | 'rejected'; operation_id: string }>(
        '/deliveries/device-bound/by-operation/' + encodeURIComponent(intent.operationId), {}, owner)
      if (original.operation_id !== intent.operationId) throw new Error('原操作回执不匹配，请继续核验')
      if (original.state === 'rejected') {
        await persistPublishDraft({ ...draft, state: 'acknowledged', jobStatus: 'failed', jobStatusVerified: true, jobPhase: 'rejected', jobError: '原发布已明确拒绝，请检查飞书连接和目标' })
        return
      }
      if (original.state !== 'accepted') throw new Error('原操作状态尚未确认')
    }
    const result = await queryPublishReceipt(draft)
    if (['queued', 'processing'].includes(result.job.storage_status || result.job.status) && JSON.stringify(await readFeishuAutoConsent(owner)) === JSON.stringify(intent.consent)) {
      await feishuApi('/deliveries/' + encodeURIComponent(result.job.id) + '/resume-device', { method: 'POST', body: '{}' }, owner)
    }
    return
  }
  validateDevicePayload(intent)
  const consent = await readFeishuAutoConsent(owner)
  if (JSON.stringify(consent) !== JSON.stringify(intent.consent)) throw new Error('自动发布设置已关闭或变化，原任务未发送')
  const preferences = await readFeishuLocalPreferences(owner)
  const options = newSnapshotPublishOptions(preferences)
  if (publishOptionsSignature(options) !== intent.consent.settingsFingerprint ||
      JSON.stringify(options) !== JSON.stringify(intent.options)) throw new Error('自动发布目标已变化，原任务未发送')
  const note = await getNote(noteId, { expectedOwner: owner })
  if (!note || note.deleted || note.status !== 'done' || note.title !== intent.note.title || note.content !== intent.note.content) throw new Error('原纪要尚未保存或已变化，自动发布未发送')
  const status = await feishuApi<FeishuStatus>('/status', {}, owner)
  if (status.device_bound_publish_protocol !== 1 || status.connection_binding_hash !== intent.consent.connectionBinding) throw new Error('飞书服务或连接已变化，请重新确认自动发布设置')
  const review = await reviewPublishOptions(owner, options)
  await assertFeishuPublishReady(owner)
  if (JSON.stringify(await readFeishuAutoConsent(owner)) !== JSON.stringify(intent.consent)) throw new Error('自动发布授权已变化，原任务未发送')
  if (!draft) {
    draft = { ...newPublishDraft(owner, noteId, intent.note, options), operationId: intent.operationId, review }
    await persistPublishDraft(draft)
  }
  const boundOptions = { ...draft.options, expected_connection_binding: intent.consent.connectionBinding }
  // Persist the exact server-bound payload before minting the one-shot attempt.
  draft = { ...draft, options: boundOptions, review }
  await persistPublishDraft(draft)
  const attempt = await beginPublishAttempt(draft)
  try {
    const accepted = await publishToFeishu(attempt.draft.publicationKey || noteId, intent.note.title, intent.note.content,
      false, owner, { ...boundOptions, operation_id: intent.operationId }, attempt.attempt)
    if (!accepted?.id || accepted.operation_id !== intent.operationId) throw new Error('发布回执未确认，原任务保留')
    await persistPublishDraft({ ...attempt.draft, state: 'acknowledged', jobId: accepted.id, jobStatus: accepted.storage_status || accepted.status, jobPhase: accepted.phase, jobError: accepted.error, jobStatusVerified: !!accepted.storage_status })
  } catch (error) {
    try { await restoreUndispatchedPublish(attempt.draft, attempt.attempt, error) } catch { /* Unknown outcomes are query-only. */ }
    throw error
  }
}
