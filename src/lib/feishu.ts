import { readAccountId } from './storage'
import Storage from '@react-native-async-storage/async-storage'
import { integrationJson, IntegrationError } from './integration'
import { createConnectorPluginStore } from './connectorPlugins'
import { identityEpoch } from './sessionIdentity'
import type { FormattingReceipt } from './feishuFormatting'
import { dispatchFeishuPublish, type FeishuPublishAttempt } from './feishuPublishAttempt'

export type FeishuDestination = { kind: 'personal' | 'folder' | 'wiki'; folder_token?: string; space_id?: string; node_token?: string }
export type FeishuContact = { open_id: string; selection_token: string; name?: string; expiresAt?: number }
export type FeishuContactPage = { items: FeishuContact[]; has_more: boolean; page_token: string; selection_expires_in: number }
export const contactRecipients = (contacts: FeishuContact[]) => contacts.map(({ open_id, selection_token }) => ({ open_id, selection_token }))
export const contactsValid = (contacts: FeishuContact[]) => contacts.every(item => !!item.name?.trim() && !!item.selection_token && !!item.expiresAt && item.expiresAt > Date.now())
export async function feishuContacts(query: string, page_token = '', owner?: string) {
  const started = Date.now()
  const result = await feishuApi<FeishuContactPage>('/contacts?' + new URLSearchParams({ query, page_size: '20', page_token }), { headers: { 'Cache-Control': 'no-cache' } }, owner)
  if (!Array.isArray(result.items) || typeof result.has_more !== 'boolean' || typeof result.page_token !== 'string' || (result.has_more && !result.page_token) || !Number.isFinite(result.selection_expires_in) || !(result.selection_expires_in > 0) || result.items.some(item => !item || typeof item.name !== 'string' || !item.name.trim() || typeof item.open_id !== 'string' || !/^ou_[A-Za-z0-9_-]+$/.test(item.open_id) || typeof item.selection_token !== 'string' || !item.selection_token)) throw new Error('联系人响应未核验，请重新读取')
  return { ...result, items: result.items.map(({ open_id, name, selection_token }) => ({ open_id, name, selection_token, expiresAt: started + Math.min(result.selection_expires_in, 900) * 1000 })) }
}
export type PublishOptions = { recipient_access_policy?: 'grant_view_and_notify'; destination_config?: FeishuDestination; permission_policy?: 'private' | 'inherit'; notify_self?: boolean; groups?: string[]; contacts?: FeishuContact[]; version_id?: string; revision_id?: string; operation_id?: string }
export function newSnapshotPublishOptions(options: PublishOptions): PublishOptions {
  const { recipient_access_policy: _, ...rest } = options
  return { ...rest, ...(options.groups?.length || options.contacts?.length ? { recipient_access_policy: 'grant_view_and_notify' as const } : {}) }
}
export function feishuPublishBody(key: string, title: string, content: string, automatic: boolean, options: PublishOptions = {}) {
  return { note_key: key, title, content, automatic,
    ...Object.fromEntries(Object.entries(options).filter(([name]) => !['version_id', 'revision_id'].includes(name))),
    ...(!automatic ? { source_mode: 'local_snapshot' as const } : {}),
    ...(options.contacts ? { contacts: contactRecipients(options.contacts) } : {}) }
}

export type FeishuStatus = {
  publish_receipt_protocol?: number
  contact_selection_protocol?: number
  recipient_access_protocol?: number
  setup?: { ready: boolean; missing: string[] }
  connection_state?: string
  grant_state?: string
  configured: boolean
  connected: boolean
  expired: boolean
  name: string
  notify_self: boolean
  groups: string[]
  auto_publish: boolean
  destination_config?: FeishuDestination
  permission_policy?: 'private' | 'inherit'
  capabilities?: Record<string, unknown>
}
export type FeishuAuthorization = { url: string; qr_data_url: string; expires_at: number }
export type FeishuGroup = { chat_id: string; name: string }
export type Delivery = {
  id: string
  recipient_access_policy?: string | null
  error_code?: string
  formatting?: FormattingReceipt
  operation_id?: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  needs_document_recovery?: boolean
  document_url: string
  error: string
  phase?: string
  permission?: { status: string; policy?: string; error?: string; note?: string }
  version_id?: string
  revision_id?: string
  publication_mode?: string
  recipients: Record<string, { name: string; status: string; error?: string; kind?: string; reading_permission?: { status: string; note?: string } }>
}
export const recoverDeliveryDocument = (id: string, url: string, owner?: string) =>
  feishuApi<Delivery>('/deliveries/' + encodeURIComponent(id) + '/document', {
    method: 'POST',
    body: JSON.stringify({ url }),
  }, owner)
export async function feishuApi<T>(
  path: string,
  init: RequestInit = {},
  expectedOwner?: string,
): Promise<T> {
  try { return await integrationJson<T>(`/api/feishu${path}`, init, expectedOwner) }
  catch (cause) {
    if (cause instanceof IntegrationError && cause.code === 'INTEGRATION_NOT_CONFIGURED') throw Object.assign(new Error('飞书接入尚未启用，请联系管理员更新服务配置'), { code: 'FEISHU_NOT_CONFIGURED' })
    throw cause
  }
}
export const deliveryStatus = (key: string, owner?: string) =>
  feishuApi<Delivery | null>('/deliveries/' + encodeURIComponent(key), {}, owner)
export const deliveryById = (id: string, owner: string) => feishuApi<Delivery>('/deliveries/by-id/' + encodeURIComponent(id), {}, owner)
export const deliveryByOperation = (id: string, owner: string) => feishuApi<Delivery>('/deliveries/by-operation/' + encodeURIComponent(id), {}, owner)
// Reads existing ACLs only; the service must never grant or send in this endpoint.
export const verifyDeliveryPermissions = (id: string, owner: string) => feishuApi<Delivery>('/deliveries/' + encodeURIComponent(id) + '/verify-permissions', { method: 'POST', body: '{}' }, owner)
export class FeishuPreflightError extends Error {
  readonly code = 'FEISHU_PLUGIN_UNAVAILABLE'
  readonly dispatchState = 'not_dispatched'
  constructor() { super('请先在插件中安装并启用飞书，再发布文档'); this.name = 'FeishuPreflightError' }
}
export async function assertFeishuPublishReady(owner: string, epoch = identityEpoch()): Promise<void> {
  const guard = () => { if (!owner || identityEpoch() !== epoch) throw new Error('账号会话已变化，原发布草稿保留') }
  guard()
  const account = await readAccountId(); guard()
  if (account !== owner) throw new Error('账号已变化，请重新操作')
  const plugin = await createConnectorPluginStore(Storage).read(owner, () => identityEpoch() === epoch)
  guard()
  if (await readAccountId() !== owner) throw new Error('账号已变化，请重新操作')
  guard()
  if (!plugin.installed || !plugin.enabled) throw new FeishuPreflightError()
}
export const publishToFeishu = async (
  key: string,
  title: string,
  content: string,
  automatic = false,
  owner?: string,
  options?: PublishOptions,
  attempt?: FeishuPublishAttempt,
) => {
  const epoch = identityEpoch()
  const account = await readAccountId()
  if (!account || (owner && account !== owner)) throw new Error('账号已变化，请重新操作')
  const payload = feishuPublishBody(key, title, content, automatic, options)
  return dispatchFeishuPublish(attempt, account, options?.operation_id || '', payload,
    () => assertFeishuPublishReady(account, epoch), () => feishuApi<Delivery | null>(
    '/deliveries',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    account,
  ))
}
export const retryDelivery = (id: string, recipients?: string[], owner?: string) =>
  feishuApi<Delivery>('/deliveries/' + encodeURIComponent(id) + '/retry', {
    method: 'POST',
    ...(recipients ? { body: JSON.stringify({ recipients }) } : {}),
  }, owner)

export async function queueAutomaticDelivery(
  note: { id: string; title: string; content: string },
  owner: string,
) {
  if ((await readAccountId()) !== owner) return
  await Storage.setItem(
    `vinote:${owner}:feishu-outbox:${note.id}`,
    JSON.stringify(note),
  )
  // This legacy format has no operation id. Never replay an uncertain POST.
}
export async function flushAutomaticDeliveries() {
  const owner = await readAccountId()
  if (!owner) return
  const prefix = `vinote:${owner}:feishu-outbox:`
  const count = (await Storage.getAllKeys()).filter(item => item.startsWith(prefix)).length
  if (await readAccountId() !== owner) throw new Error('账号已切换，原发布记录仍保留')
  if (count) throw new Error('旧发布记录待核验：缺少原 operation ID，不能确认是否已创建文档。记录仍保留，未自动重发；请在内容详情核对已有文档。')
}
