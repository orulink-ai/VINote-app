import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import { integrationBaseUrl, operationId } from './integration'
import { deliveryById, deliveryByOperation, feishuPublishBody, newSnapshotPublishOptions, type Delivery, type PublishOptions } from './feishu'
import type { PublishReview } from './feishuPublishReview'
import { identityEpoch } from './sessionIdentity'
import { createFeishuPublishAttempt, provedNotDispatched, type FeishuPublishAttempt } from './feishuPublishAttempt'

export type PublishDraft = {
  owner: string; noteKey: string; origin: string; operationId: string
  snapshot: { title: string; content: string; versionId?: string; revisionId?: string }
  options: PublishOptions; state: 'draft' | 'unknown' | 'acknowledged'; jobId?: string
  review?: PublishReview
  publicationKey?: string
}
const key = (owner: string, note: string) => `vinote:${owner}:feishu-publish:${encodeURIComponent(note)}`
async function guard(owner: string, epoch: number) { if (!owner || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，原发布草稿保留') }
export async function readPublishDraft(owner: string, note: string): Promise<PublishDraft | null> {
  const epoch = identityEpoch()
  await guard(owner, epoch)
  const raw = await Storage.getItem(key(owner, note)); await guard(owner, epoch)
  if (!raw) return null
  const draft = JSON.parse(raw) as PublishDraft
  if (draft.owner !== owner || draft.noteKey !== note || !draft.operationId || !draft.snapshot || !draft.options || !['draft', 'unknown', 'acknowledged'].includes(draft.state)) throw new Error('发布草稿记录异常，请保留原记录')
  if (draft.origin !== integrationBaseUrl) throw new Error('原发布属于其他服务，请返回原服务核验；草稿保留')
  if (draft.publicationKey !== undefined && draft.publicationKey !== `publish:${note}`) throw new Error('发布来源隔离标识无效，原记录保留')
  return draft
}
export function newPublishDraft(owner: string, noteKey: string, snapshot: PublishDraft['snapshot'], options: PublishOptions): PublishDraft {
  return { owner, noteKey, publicationKey: `publish:${noteKey}`, origin: integrationBaseUrl, operationId: operationId(), snapshot: { ...snapshot }, options: JSON.parse(JSON.stringify(newSnapshotPublishOptions(options))), state: 'draft' }
}
let writes: Promise<void> = Promise.resolve()
const liveAttempts = new WeakMap<FeishuPublishAttempt, string>()
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const job = writes.catch(() => {}).then(run)
  writes = job.then(() => undefined, () => undefined)
  return job
}
export function beginPublishAttempt(draft: PublishDraft): Promise<{ draft: PublishDraft; attempt: FeishuPublishAttempt }> {
  const copy: PublishDraft = JSON.parse(JSON.stringify(draft)), epoch = identityEpoch()
  return serialized(async () => {
    await guard(copy.owner, epoch)
    const previous = await readPublishDraft(copy.owner, copy.noteKey)
    if (copy.state !== 'draft' || !previous || previous.state !== 'draft' || previous.operationId !== copy.operationId || previous.publicationKey !== copy.publicationKey ||
        JSON.stringify(previous.snapshot) !== JSON.stringify(copy.snapshot)) throw new Error('原发布不是当前未提交草稿，不能创建新的 attempt')
    const attempt = createFeishuPublishAttempt(copy.owner, copy.operationId,
      feishuPublishBody(copy.publicationKey || copy.noteKey, copy.snapshot.title, copy.snapshot.content, false, { ...copy.options, operation_id: copy.operationId }))
    const unknown = { ...copy, state: 'unknown' as const }
    await persist(unknown, epoch)
    liveAttempts.set(attempt, JSON.stringify(unknown))
    return { draft: unknown, attempt }
  })
}
export function restoreUndispatchedPublish(draft: PublishDraft, attempt: FeishuPublishAttempt, error: unknown): Promise<PublishDraft> {
  const epoch = identityEpoch()
  return serialized(async () => {
    await guard(draft.owner, epoch)
    const exact = liveAttempts.get(attempt)
    if (!exact || exact !== JSON.stringify(draft) || !provedNotDispatched(error, attempt, draft.owner, draft.operationId)) throw new Error('没有本次 attempt 的未发送证明，原 unknown 保留')
    const previous = await readPublishDraft(draft.owner, draft.noteKey)
    const archiveKey = `${key(draft.owner, draft.noteKey)}:${draft.operationId}`
    const archived = await Storage.getItem(archiveKey)
    await guard(draft.owner, epoch)
    if (JSON.stringify(previous) !== exact || archived !== exact) throw new Error('原发布已变化，不能解除 unknown')
    const restored = { ...previous!, state: 'draft' as const }
    // Only this freshly minted operation/attempt can cross unknown -> draft.
    await Storage.setItem(archiveKey, JSON.stringify(restored)); await guard(draft.owner, epoch)
    await Storage.setItem(key(draft.owner, draft.noteKey), JSON.stringify(restored)); await guard(draft.owner, epoch)
    liveAttempts.delete(attempt)
    return restored
  })
}
export function persistPublishDraft(draft: PublishDraft): Promise<void> {
  const copy: PublishDraft = JSON.parse(JSON.stringify(draft))
  const epoch = identityEpoch()
  const job = writes.catch(() => {}).then(() => persist(copy, epoch))
  writes = job
  return job
}
async function persist(draft: PublishDraft, epoch: number) {
  await guard(draft.owner, epoch)
  const previous = await readPublishDraft(draft.owner, draft.noteKey)
  if (previous && previous.state !== 'draft' && previous.operationId === draft.operationId && previous.publicationKey !== draft.publicationKey) throw new Error('原发布来源已冻结，不能替换隔离标识')
  if (previous && previous.state !== 'draft' && previous.operationId === draft.operationId &&
      JSON.stringify(previous.review) !== JSON.stringify(draft.review)) throw new Error('原发布核对记录已冻结，不能替换对象名称或位置')
  if (previous && previous.operationId !== draft.operationId && draft.state !== 'draft') throw new Error('当前发布操作已变化，旧回执不能覆盖新草稿')
  if (previous?.state === 'acknowledged' && previous.operationId === draft.operationId && (draft.state === 'draft' || JSON.stringify(previous.snapshot) !== JSON.stringify(draft.snapshot) || JSON.stringify(previous.options) !== JSON.stringify(draft.options))) throw new Error('已提交发布输入不可改变')
  if (previous?.state === 'unknown' && (draft.state === 'draft' || previous.operationId !== draft.operationId || JSON.stringify(previous.snapshot) !== JSON.stringify(draft.snapshot) || JSON.stringify(previous.options) !== JSON.stringify(draft.options))) throw new Error('原发布结果未确认，不能改变输入或创建新提交')
  if (draft.origin !== integrationBaseUrl) throw new Error('原发布服务已变化')
  await guard(draft.owner, epoch)
  // Preserve every dispatched intent; the note pointer is not the only record.
  if (draft.state !== 'draft') await Storage.setItem(`${key(draft.owner, draft.noteKey)}:${draft.operationId}`, JSON.stringify(draft))
  await guard(draft.owner, epoch)
  await Storage.setItem(key(draft.owner, draft.noteKey), JSON.stringify(draft)); await guard(draft.owner, epoch)
}
export async function queryPublishReceipt(draft: PublishDraft): Promise<{ draft: PublishDraft; job: Delivery }> {
  const epoch = identityEpoch()
  await guard(draft.owner, epoch)
  if (draft.origin !== integrationBaseUrl || draft.state === 'draft') throw new Error('尚未提交或服务已变化，不能查询其他请求')
  // 404 propagates and leaves the durable unknown untouched. Never POST here.
  const job = draft.jobId ? await deliveryById(draft.jobId, draft.owner) : await deliveryByOperation(draft.operationId, draft.owner)
  await guard(draft.owner, epoch)
  if ((draft.jobId && job.id !== draft.jobId) || (!draft.jobId && job.operation_id !== draft.operationId) || !job.id) throw new Error('返回回执不属于原发布操作')
  const confirmed = { ...draft, state: 'acknowledged' as const, jobId: job.id }
  await persistPublishDraft(confirmed)
  return { draft: confirmed, job }
}
