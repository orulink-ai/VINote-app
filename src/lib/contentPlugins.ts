import Storage from '@react-native-async-storage/async-storage'
import { integrationJson, operationId } from './integration'
import { readAccountId } from './storage'

export type ContentPlugin = { id: string; name: string; description: string; installed: boolean; enabled: boolean }
export type PluginRun = { id: string; plugin_id: string; note_key: string; status: string; output: string; error: string; model: string; base_revision: number; created_at: string; source_version_id?: string; source_content?: string; source_title?: string; language?: string; retry_safe?: boolean }
export type PluginIntent = { plugin_id: 'translation' | 'diagram'; note_key: string; version_id: string; base_revision: number; operation_id: string; language: string; glossary: string }
const key = (owner: string) => `vinote:${owner}:plugin-intent`
async function guard(owner: string) { if (await readAccountId() !== owner) throw new Error('账号已切换，请重新打开插件') }
export async function readPluginIntent(owner: string): Promise<PluginIntent | null> {
  await guard(owner)
  const raw = await Storage.getItem(key(owner))
  await guard(owner)
  return raw ? JSON.parse(raw) : null
}
export async function writePluginIntent(owner: string, intent: PluginIntent) {
  await guard(owner)
  await Storage.setItem(key(owner), JSON.stringify(intent))
  await guard(owner)
}
export async function clearPluginIntent(owner: string) { await guard(owner); await Storage.removeItem(key(owner)); await guard(owner) }
export function newPluginIntent(input: Omit<PluginIntent, 'operation_id' | 'glossary'>): PluginIntent { return { ...input, operation_id: operationId(), glossary: '' } }
export const pluginCatalog = (owner: string) => integrationJson<ContentPlugin[]>('/api/plugins', {}, owner)
export const pluginRuns = (owner: string) => integrationJson<PluginRun[]>('/api/plugins/runs', {}, owner)
export const pluginRun = (owner: string, id: string) => integrationJson<PluginRun>(`/api/plugins/runs/${encodeURIComponent(id)}`, {}, owner)
export const pluginSetting = (owner: string, id: string, installed: boolean, enabled: boolean) => integrationJson<ContentPlugin[]>(`/api/plugins/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ installed, enabled }) }, owner)
export async function submitPlugin(owner: string, intent: PluginIntent) {
  if (intent.plugin_id === 'diagram') throw new Error('新的流程图生成已停止，历史记录和结果保留')
  // The intent must survive before any side effect, including lost HTTP receipts.
  await writePluginIntent(owner, intent)
  return integrationJson<PluginRun>('/api/plugins/runs', { method: 'POST', body: JSON.stringify(intent) }, owner, 180000)
}
export async function retryPlugin(_owner: string, _id: string): Promise<PluginRun> {
  throw new Error('旧内容插件不再重新生成，请核验历史结果；全文翻译从 MCP 工具进入')
}
export const savePlugin = (owner: string, id: string) => integrationJson(`/api/plugins/runs/${encodeURIComponent(id)}/save`, { method: 'POST' }, owner, 125000)
export const pluginLabel = (status: string) => ({ running: '正在处理', interrupted: '处理待核验', failed: '生成失败', ready: '等待核对', saved: '新版本已保存' }[status] || '结果待核验')
