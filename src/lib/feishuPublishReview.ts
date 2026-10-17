import { feishuApi, type FeishuGroup, type FeishuStatus, type PublishOptions } from './feishu'
import { feishuVerificationUnavailable, feishuVerificationMessage } from './feishuConnectionState'
import { readAccountId } from './storage'
import { identityEpoch } from './sessionIdentity'

// Local display evidence only. Never include this in the remote publish payload.
export type PublishReview = {
  optionsSignature: string
  selfName?: string
  groups: FeishuGroup[]
  contacts?: { open_id: string; name: string }[]
  destination: { name: string; path: string[]; path_complete: boolean; can_create: boolean }
}
export function publishOptionsSignature(options: PublishOptions) {
  const target = options.destination_config || { kind: 'personal' }
  return JSON.stringify([target.kind, target.folder_token || '', target.space_id || '', target.node_token || '',
    options.permission_policy || (target.kind === 'personal' ? 'private' : 'inherit'), !!options.notify_self, options.groups || [],
    ...(options.contacts?.length ? [options.contacts.map(item => [item.open_id, item.selection_token, item.name])] : []),
    ...(options.recipient_access_policy ? [options.recipient_access_policy] : [])])
}
export function hasPublishReview(options: PublishOptions, review?: PublishReview): review is PublishReview {
  return !!review && review.optionsSignature === publishOptionsSignature(options) &&
    !!review.destination?.name?.trim() && Array.isArray(review.destination.path) && review.destination.path.length > 0 &&
    review.destination.path.every(part => typeof part === 'string' && !!part.trim()) &&
    (!options.notify_self || !!review.selfName?.trim()) && Array.isArray(review.groups) &&
    (options.groups || []).every(id => review.groups.some(group => group.chat_id === id && !!group.name?.trim())) &&
    (options.contacts || []).every(item => !!item.name?.trim() && !!item.selection_token && review.contacts?.some(contact => contact.open_id === item.open_id && contact.name === item.name))
}
export async function reviewPublishOptions(owner: string, options: PublishOptions): Promise<PublishReview> {
  const selected: PublishOptions = JSON.parse(JSON.stringify(options))
  const epoch = identityEpoch()
  const guard = async () => { if (!owner || await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，发布对象未核验') }
  await guard()
  const [status, groups, destination] = await Promise.all([
    feishuApi<FeishuStatus>('/status', {}, owner),
    selected.groups?.length ? feishuApi<FeishuGroup[]>('/groups', {}, owner) : Promise.resolve<FeishuGroup[]>([]),
    feishuApi<{ name?: string; path?: string[]; path_complete?: boolean; can_create?: boolean; can_attempt_create?: boolean; reason?: string }>(
      '/destinations/check', { method: 'POST', body: JSON.stringify(selected.destination_config || { kind: 'personal' }) }, owner),
  ])
  await guard()
  if (feishuVerificationUnavailable(status)) throw new Error(feishuVerificationMessage)
  if (!status.connected || status.expired) throw new Error('飞书本人身份未核验，请检查连接')
  if (status.publish_receipt_protocol !== 1) throw new Error('飞书服务需要升级发布回执协议，发布对象未确认')
  if (selected.recipient_access_policy && status.recipient_access_protocol !== 1) throw new Error('飞书服务需要升级收件人阅读权限协议；尚未提交，原选择保留')
  if (selected.contacts?.length && status.contact_selection_protocol !== 1) throw new Error('飞书服务尚未支持联系人选择，原选择保留，请升级服务')
  if (!destination.can_attempt_create) throw new Error(destination.reason || '目标创建能力未核验，不能确认发布')
  if (!destination.name?.trim() || !destination.path?.length ||
      destination.path.some(part => typeof part !== 'string' || !part.trim()) ||
      (selected.destination_config?.kind !== 'personal' && ['文件夹', '知识库节点'].includes(destination.name))) {
    throw new Error('实际位置名称或路径未核验，不能用位置标识代替确认')
  }
  if (selected.notify_self && !status.name?.trim()) throw new Error('通知本人的飞书姓名未核验')
  if (!Array.isArray(groups)) throw new Error('已选群名称未核验，请重新读取')
  const recipients: FeishuGroup[] = []
  for (const id of selected.groups || []) {
    const group = groups.find(item => item.chat_id === id)
    if (!group?.name?.trim()) throw new Error('部分已选群名称或成员可见性未核验，请检查飞书设置后重新读取')
    recipients.push({ chat_id: id, name: group.name })
  }
  return {
    optionsSignature: publishOptionsSignature(selected), selfName: selected.notify_self ? status.name : undefined,
    groups: recipients,
    ...(selected.contacts?.length ? { contacts: selected.contacts.map(item => ({ open_id: item.open_id, name: item.name || '' })) } : {}),
    destination: { name: destination.name, path: [...destination.path], path_complete: destination.path_complete === true, can_create: destination.can_create === true },
  }
}
