import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'
import type { FeishuDestination } from './feishu'

export type FeishuLocalPreferences = { notify_self: boolean; groups: string[]; destination_config: FeishuDestination; permission_policy: 'private' | 'inherit' }
const defaults = (): FeishuLocalPreferences => ({ notify_self: true, groups: [], destination_config: { kind: 'personal' }, permission_policy: 'private' })
async function scope(owner: string, epoch: number) {
  if (!owner || identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已变化，请重新打开飞书设置')
}
export async function readFeishuLocalPreferencesState(owner: string): Promise<{ preferences: FeishuLocalPreferences; exists: boolean }> {
  const epoch = identityEpoch(); await scope(owner, epoch)
  const raw = await Storage.getItem(`vinote:${owner}:feishu-local-preferences`)
  await scope(owner, epoch)
  if (!raw) return { preferences: defaults(), exists: false }
  const value = JSON.parse(raw) as FeishuLocalPreferences
  if (typeof value.notify_self !== 'boolean' || !Array.isArray(value.groups) || value.groups.some(g => typeof g !== 'string') || !value.destination_config || !['personal', 'folder', 'wiki'].includes(value.destination_config.kind) || !['private', 'inherit'].includes(value.permission_policy)) throw new Error('本机飞书设置无法读取，请重新设置')
  return { preferences: value, exists: true }
}
export async function readFeishuLocalPreferences(owner: string): Promise<FeishuLocalPreferences> {
  return (await readFeishuLocalPreferencesState(owner)).preferences
}
export async function saveFeishuLocalPreferences(owner: string, value: FeishuLocalPreferences): Promise<void> {
  const epoch = identityEpoch(); await scope(owner, epoch)
  await Storage.setItem(`vinote:${owner}:feishu-local-preferences`, JSON.stringify(value))
  await scope(owner, epoch)
}
