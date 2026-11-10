import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'
import { integrationBaseUrl, operationId } from './integration'
import type { PublishOptions } from './feishu'
import type { FeishuAutoConsent } from './feishuAutoConsent'
import { readFeishuAutoConsent } from './feishuAutoConsent'
import { readFeishuLocalPreferences } from './feishuLocalPreferences'
import { newSnapshotPublishOptions } from './feishu'
import { publishOptionsSignature } from './feishuPublishReview'

export type AutomaticNote = { id: string; title: string; content: string }
export type AutomaticIntent = { owner: string; origin: string; operationId: string; note: AutomaticNote; consent: FeishuAutoConsent; options: PublishOptions; state: 'prepared' }
const key = (owner: string, note: string) => `vinote:${owner}:feishu-automatic:v1:${encodeURIComponent(note)}`
async function guard(owner: string, epoch: number) {
  if (!owner || identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，自动发布任务保留在原账号')
}
export async function readFeishuAutomatic(owner: string, note: string): Promise<AutomaticIntent | null> {
  const epoch = identityEpoch(); await guard(owner, epoch)
  const raw = await Storage.getItem(key(owner, note)); await guard(owner, epoch)
  if (!raw) return null
  const intent = JSON.parse(raw) as AutomaticIntent
  if (intent.owner !== owner || intent.note?.id !== note || intent.origin !== integrationBaseUrl || !intent.operationId || intent.state !== 'prepared') throw new Error('自动发布记录无法核验，原记录保留')
  return intent
}
let writes: Promise<void> = Promise.resolve()
export function enqueueFeishuAutomatic(owner: string, note: AutomaticNote, consent: FeishuAutoConsent, options: PublishOptions, fixedOperation?: string): Promise<AutomaticIntent> {
  const epoch = identityEpoch()
  const input = JSON.parse(JSON.stringify({ note, consent, options })) as { note: AutomaticNote; consent: FeishuAutoConsent; options: PublishOptions }
  const work = writes.catch(() => {}).then(async () => {
    await guard(owner, epoch)
    if (!input.note.id || !input.note.title.trim() || !input.note.content.trim() || !input.consent.connectionBinding || !input.consent.settingsFingerprint) throw new Error('自动发布内容或授权不完整')
    const previous = await readFeishuAutomatic(owner, input.note.id)
    await guard(owner, epoch)
    if (previous) {
      if ((fixedOperation && previous.operationId !== fixedOperation) || JSON.stringify({ note: previous.note, consent: previous.consent, options: previous.options }) !== JSON.stringify(input)) throw new Error('已有不同的自动发布任务，原记录保留')
      return previous
    }
    const intent: AutomaticIntent = { owner, origin: integrationBaseUrl, operationId: fixedOperation || operationId(), ...input, state: 'prepared' }
    await Storage.setItem(key(owner, input.note.id), JSON.stringify(intent)); await guard(owner, epoch)
    return intent
  })
  writes = work.then(() => undefined, () => undefined)
  return work
}

/** Called before saving a new note; the worker verifies the saved note before sending. */
export async function createAutomaticHandoff(owner: string, note: AutomaticNote): Promise<AutomaticIntent | null> {
  const consent = await readFeishuAutoConsent(owner)
  if (!consent) return null
  const options = newSnapshotPublishOptions(await readFeishuLocalPreferences(owner))
  if (publishOptionsSignature(options) !== consent.settingsFingerprint) throw new Error('自动发布设置已变化，请重新确认')
  return { owner, origin: integrationBaseUrl, operationId: operationId(), note, consent, options, state: 'prepared' }
}

export async function persistAutomaticHandoff(intent: AutomaticIntent): Promise<void> {
  if (intent.origin !== integrationBaseUrl || intent.state !== 'prepared') throw new Error('原自动发布任务服务已变化')
  await enqueueFeishuAutomatic(intent.owner, intent.note, intent.consent, intent.options, intent.operationId)
}

export async function listFeishuAutomaticIds(owner: string): Promise<string[]> {
  const epoch = identityEpoch(); await guard(owner, epoch)
  const prefix = `vinote:${owner}:feishu-automatic:v1:`
  const keys = await Storage.getAllKeys(); await guard(owner, epoch)
  return keys.filter(item => item.startsWith(prefix)).map(item => decodeURIComponent(item.slice(prefix.length)))
}

/** Caller holds the automatic-delivery lock; dispatched receipts are retained separately. */
export async function removeFeishuAutomatic(owner: string, note: string): Promise<void> {
  const epoch = identityEpoch(); await guard(owner, epoch)
  await Storage.removeItem(key(owner, note)); await guard(owner, epoch)
}
