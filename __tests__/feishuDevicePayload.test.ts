import { validateDevicePayload } from '../src/lib/feishuDevicePayload'
import type { AutomaticIntent } from '../src/lib/feishuAutomaticQueue'

const valid = (): AutomaticIntent => ({ owner: 'a', origin: 'server', operationId: '00000000-0000-4000-8000-000000000001',
  note: { id: 'note', title: '标题', content: '正文' }, consent: { connectionBinding: 'a'.repeat(64), settingsFingerprint: 'settings', consentId: 'consent' }, options: {}, state: 'prepared' })

test('rejects oversized text and invalid bindings before creating an unknown attempt', () => {
  expect(() => validateDevicePayload(valid())).not.toThrow()
  expect(() => validateDevicePayload({ ...valid(), note: { id: 'note', title: '标题', content: 'a'.repeat(300001) } })).toThrow('尚未发送')
  expect(() => validateDevicePayload({ ...valid(), consent: { ...valid().consent, connectionBinding: 'invalid' } })).toThrow('尚未发送')
})

test('destination identifiers must match the selected kind exactly', () => {
  expect(() => validateDevicePayload({ ...valid(), options: { destination_config: { kind: 'folder' } } })).toThrow('尚未发送')
  expect(() => validateDevicePayload({ ...valid(), options: { destination_config: { kind: 'wiki', space_id: 'space' } } })).toThrow('尚未发送')
  expect(() => validateDevicePayload({ ...valid(), options: { destination_config: { kind: 'personal', folder_token: 'extra' } } })).toThrow('尚未发送')
  expect(() => validateDevicePayload({ ...valid(), options: { destination_config: { kind: 'folder', folder_token: 'folder' } } })).not.toThrow()
})
