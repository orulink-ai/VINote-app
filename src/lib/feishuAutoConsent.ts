import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'

export type FeishuAutoConsent = { connectionBinding: string; settingsFingerprint: string; consentId: string }
const key = (owner: string) => `vinote:${owner}:feishu-auto-consent:v1`
async function guard(owner: string, epoch: number) {
  if (!owner || identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，自动发布设置未更改')
}
function valid(value: FeishuAutoConsent) {
  return typeof value.connectionBinding === 'string' && !!value.connectionBinding.trim() &&
    typeof value.settingsFingerprint === 'string' && !!value.settingsFingerprint.trim() &&
    typeof value.consentId === 'string' && !!value.consentId.trim()
}
export async function readFeishuAutoConsent(owner: string): Promise<FeishuAutoConsent | null> {
  const epoch = identityEpoch(); await guard(owner, epoch)
  const raw = await Storage.getItem(key(owner)); await guard(owner, epoch)
  if (!raw) return null
  const value = JSON.parse(raw) as FeishuAutoConsent
  if (!value || !valid(value)) throw new Error('自动发布授权记录无法核验，请重新设置')
  return value
}
export async function saveFeishuAutoConsent(owner: string, value: FeishuAutoConsent | null): Promise<void> {
  const epoch = identityEpoch(); await guard(owner, epoch)
  if (value && !valid(value)) throw new Error('飞书连接和设置尚未核验')
  if (value) await Storage.setItem(key(owner), JSON.stringify(value))
  else await Storage.removeItem(key(owner))
  await guard(owner, epoch)
}
