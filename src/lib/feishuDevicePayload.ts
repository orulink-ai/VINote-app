import type { AutomaticIntent } from './feishuAutomaticQueue'

/** Validate the dedicated endpoint's schema before creating an unknown attempt. */
export function validateDevicePayload(intent: AutomaticIntent): void {
  const { note, consent, options, operationId } = intent
  if (!note || !consent || !options || typeof note.id !== 'string' || typeof note.title !== 'string' || typeof note.content !== 'string' ||
      !/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(operationId) ||
      !/^[0-9a-f]{64}$/.test(consent.connectionBinding) ||
      !note.id || `publish:${note.id}`.length > 160 || !note.title || note.title.length > 500 ||
      !note.content || note.content.length > 300000 || (options.notify_self !== undefined && typeof options.notify_self !== 'boolean') ||
      (options.groups !== undefined && (!Array.isArray(options.groups) || options.groups.length > 20 || options.groups.some(group => typeof group !== 'string'))) ||
      (options.contacts !== undefined && (!Array.isArray(options.contacts) || options.contacts.length > 0)) ||
      (options.permission_policy !== undefined && !['private', 'inherit'].includes(options.permission_policy))) {
    throw new Error('会议纪要或发布设置超出服务支持范围，尚未发送；请检查内容或通知对象')
  }
  const destination = options.destination_config
  const fields = ['folder_token', 'space_id', 'node_token'] as const
  const required = destination?.kind === 'folder' ? ['folder_token'] : destination?.kind === 'wiki' ? ['space_id', 'node_token'] : []
  if (destination && (typeof destination !== 'object' || !['personal', 'folder', 'wiki'].includes(destination.kind) ||
      Object.keys(destination).some(key => !['kind', ...fields].includes(key)) ||
      fields.some(key => { const value = destination[key]; return value !== undefined && (typeof value !== 'string' || value.length > 100 || !/^[a-zA-Z0-9_-]*$/.test(value)) }) ||
      fields.some(key => !!destination[key] !== required.includes(key)))) {
    throw new Error('飞书文档位置格式无效，尚未发送，请重新选择位置')
  }
}
