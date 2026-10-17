import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'
import { integrationBaseUrl } from './integration'
import { deliveryById } from './feishu'

export type RetryReceipt = { owner: string; noteKey: string; origin: string; jobId: string; observedRunning: boolean }
const key = (owner: string, note: string) => `vinote:${owner}:feishu-retry:${encodeURIComponent(note)}`
async function guard(owner: string, epoch: number) {
  if (!owner || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，原重试记录保留')
}
async function read(owner: string, note: string, epoch: number): Promise<RetryReceipt | null> {
  await guard(owner, epoch)
  const raw = await Storage.getItem(key(owner, note))
  await guard(owner, epoch)
  if (!raw) return null
  const value = JSON.parse(raw) as RetryReceipt
  if (!value || value.owner !== owner || value.noteKey !== note || typeof value.jobId !== 'string' || !value.jobId.trim() || typeof value.observedRunning !== 'boolean') throw new Error('原重试记录无法核验，请保留记录')
  if (value.origin !== integrationBaseUrl) throw new Error('原重试属于其他服务，请返回原服务核验')
  return value
}
export function readRetryReceipt(owner: string, note: string) { return read(owner, note, identityEpoch()) }
let writes: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = writes.catch(() => {}).then(run)
  writes = result
  return result
}
export function beginRetryReceipt(owner: string, noteKey: string, jobId: string): Promise<RetryReceipt> {
  const epoch = identityEpoch()
  return serialize(async () => {
    if (await read(owner, noteKey, epoch)) throw new Error('原重试结果尚未确认，请查询原任务')
    if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('原任务未核验')
    const value = { owner, noteKey, origin: integrationBaseUrl, jobId, observedRunning: false }
    await guard(owner, epoch)
    await Storage.setItem(key(owner, noteKey), JSON.stringify(value))
    await guard(owner, epoch)
    return value
  })
}
// Only an exact GET can resolve uncertainty. A POST may return the old failed state.
export async function queryRetryReceipt(value: RetryReceipt) {
  const epoch = identityEpoch()
  return serialize(async () => {
    const current = await read(value.owner, value.noteKey, epoch)
    if (!current || current.jobId !== value.jobId || value.origin !== integrationBaseUrl) throw new Error('原重试记录已变化')
    const job = await deliveryById(current.jobId, current.owner)
    await guard(current.owner, epoch)
    if (!job || job.id !== current.jobId) throw new Error('查询结果不属于原重试任务')
    const pending = await (async () => {
      const saved = await read(current.owner, current.noteKey, epoch)
      if (!saved || saved.jobId !== current.jobId) throw new Error('原重试记录已变化')
      const resolved = job.phase !== 'unknown' && (job.status === 'completed' || (saved.observedRunning && job.status === 'failed'))
      const next = { ...saved, observedRunning: saved.observedRunning || ['queued', 'processing'].includes(job.status) }
      await guard(saved.owner, epoch)
      if (resolved) await Storage.removeItem(key(saved.owner, saved.noteKey))
      else await Storage.setItem(key(saved.owner, saved.noteKey), JSON.stringify(next))
      await guard(saved.owner, epoch)
      return resolved ? null : next
    })()
    return { job, pending }
  })
}
