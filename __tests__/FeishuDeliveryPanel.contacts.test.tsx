import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Pressable, TextInput } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { FeishuDeliveryPanel } from '../src/components/FeishuDeliveryPanel'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { SettingsCheckbox } from '../src/components/SettingsCheckbox'
import { feishuApi, feishuContacts, deliveryStatus, deliveryByOperation, publishToFeishu } from '../src/lib/feishu'
import { readPublishDraft } from '../src/lib/feishuPublishReceipt'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: jest.fn(() => 'contact-op') }))
jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, feishuPublishBody: jest.requireActual('../src/lib/feishu').feishuPublishBody,
  feishuApi: jest.fn(), feishuContacts: jest.fn(), deliveryStatus: jest.fn(), deliveryById: jest.fn(), deliveryByOperation: jest.fn(), assertFeishuPublishReady: jest.fn(async () => {}), publishToFeishu: jest.fn(), retryDelivery: jest.fn(), recoverDeliveryDocument: jest.fn(),
  contactsValid: (items: any[]) => items.every(item => !!item.name && item.expiresAt > Date.now()),
  contactRecipients: (items: any[]) => items.map(({ open_id, selection_token }) => ({ open_id, selection_token })),
}))
const note = { id: 'contact-note', title: '原文', content: '冻结正文' } as Note
const status = { publish_receipt_protocol: 1, recipient_access_protocol: 1, contact_selection_protocol: 1, capabilities: { contact_search: true }, configured: true, connected: true, expired: false, name: '本人甲', notify_self: false, groups: ['oc_one'], destination_config: { kind: 'personal' } }
const contact = (id: string) => ({ open_id: id, name: '同名联系人', selection_token: `proof-${id}`, expiresAt: Date.now() + 900000 })
const button = (view: Renderer.ReactTestRenderer, title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
const checkbox = (view: Renderer.ReactTestRenderer, label: string) => view.root.findAllByType(SettingsCheckbox).find(node => node.props.label === label)!
const input = (view: Renderer.ReactTestRenderer) => view.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '搜索联系人')!
const text = (view: Renderer.ReactTestRenderer) => JSON.stringify(view.toJSON())
let view: Renderer.ReactTestRenderer
beforeEach(async () => {
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.clearAllMocks()
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  jest.mocked(feishuApi).mockImplementation(async path => {
    if (path === '/status') return status
    if (path === '/groups') return [{ chat_id: 'oc_one', name: '原群' }, { chat_id: 'oc_two', name: '新增群' }]
    return { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_create: true, can_attempt_create: true }
  })
})
afterEach(async () => { if (view) await act(async () => view.unmount()) })
const mount = async () => { await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) }); await act(async () => view.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('通知 ·') && typeof node.props.onPress === 'function')[0]?.props.onPress()) }
const search = async () => {
  await act(async () => input(view).props.onChangeText('同名'))
  await act(async () => button(view, '搜索联系人').props.onPress())
}

test('this publication can add/remove groups, keep changes on reread, and invalidate confirmation', async () => {
  await mount()
  await act(async () => button(view, '读取本次可选群').props.onPress())
  expect(checkbox(view, '通知群：原群').props.checked).toBe(true)
  await act(async () => checkbox(view, '通知群：新增群').props.onChange(true))
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(false)
  await act(async () => checkbox(view, '通知群：原群').props.onChange(false))
  expect((await readPublishDraft('owner', note.id))?.options.groups).toEqual(['oc_two'])
  await act(async () => button(view, '读取本次可选群').props.onPress())
  expect(checkbox(view, '通知群：原群').props.checked).toBe(false)
  expect(checkbox(view, '通知群：新增群').props.checked).toBe(true)
  expect((await readPublishDraft('owner', note.id))?.options.groups).toEqual(['oc_two'])
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('contact pages fail independently, retry the exact cursor, and freeze display names without sending names', async () => {
  jest.mocked(feishuContacts).mockResolvedValueOnce({ items: [contact('ou_one')], has_more: true, page_token: 'next', selection_expires_in: 900 })
    .mockRejectedValueOnce(new Error('下一页读取失败'))
    .mockResolvedValueOnce({ items: [contact('ou_two')], has_more: false, page_token: '', selection_expires_in: 900 })
  await mount(); await search()
  await act(async () => checkbox(view, '同名联系人').props.onChange(true))
  await act(async () => button(view, '读取下一页联系人').props.onPress())
  expect(text(view)).toContain('下一页读取失败')
  expect(checkbox(view, '同名联系人').props.checked).toBe(true)
  await act(async () => button(view, '重试联系人读取').props.onPress())
  expect(feishuContacts).toHaveBeenLastCalledWith('同名', 'next', 'owner')
  expect(text(view)).not.toMatch(/ou_one|ou_two|proof-ou_/)
  await act(async () => view.root.findAllByType(SettingsCheckbox).filter(node => node.props.label === '同名联系人')[1].props.onChange(true))
  await act(async () => view.root.findAllByType(PrimaryButton).filter(node => node.props.title === '移除联系人：同名联系人')[1].props.onPress())
  expect(view.root.findAllByType(SettingsCheckbox).filter(node => node.props.label === '同名联系人')[1].props.checked).toBe(false)
  jest.mocked(publishToFeishu).mockRejectedValue(new Error('未知提交结果'))
  await act(async () => button(view, '创建飞书文档并通知').props.onPress())
  expect(publishToFeishu).toHaveBeenCalledTimes(1)
  expect(jest.mocked(publishToFeishu).mock.calls[0][5]?.contacts).toEqual([{ open_id: 'ou_one', selection_token: 'proof-ou_one' }])
  const saved = await readPublishDraft('owner', note.id)
  expect(saved).toMatchObject({ state: 'unknown', options: { contacts: [{ open_id: 'ou_one', name: '同名联系人' }] }, review: { contacts: [{ open_id: 'ou_one', name: '同名联系人' }] } })
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('原回执不可用'))
  await act(async () => button(view, '重新加载交付状态').props.onPress())
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(true)
  expect(publishToFeishu).toHaveBeenCalledTimes(1)
  expect(text(view)).toContain('同名联系人')
  expect(await readPublishDraft('owner', note.id)).toEqual(saved)
})

test('missing protocol leaves contacts unavailable and ordinary group selection usable', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => path === '/status' ? { ...status, contact_selection_protocol: undefined } : api(path, ...args))
  await mount()
  expect(input(view).props.editable).toBe(false)
  expect(text(view)).toContain('飞书服务尚未支持联系人选择')
  await act(async () => button(view, '搜索联系人').props.onPress())
  expect(feishuContacts).not.toHaveBeenCalled()
  expect(button(view, '读取本次可选群').props.disabled).toBe(false)
})

test('failed without an error stays failed and legacy permission gets a readable label', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue({ id: 'job', status: 'failed', phase: 'partial_success', document_url: 'https://company.feishu.cn/docx/doc', permission: { status: 'legacy_unverified' }, recipients: { ou_one: { name: '联系人甲', status: 'failed' } }, error: '' })
  await mount()
  expect(text(view)).toContain('发送失败')
  expect(text(view)).toContain('旧记录未核验')
  expect(text(view)).toContain('已创建，可打开核验')
  expect(text(view)).not.toContain('legacy_unverified')
  expect(button(view, '仅重试 联系人甲')).toBeDefined()
})

test('a late search after an owner epoch change cannot select a previous session result', async () => {
  let finish!: (value: Awaited<ReturnType<typeof feishuContacts>>) => void
  jest.mocked(feishuContacts).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await act(async () => input(view).props.onChangeText('旧查询'))
  await act(async () => { void button(view, '搜索联系人').props.onPress() })
  await act(async () => { transitionIdentity('other'); transitionIdentity('owner') })
  await act(async () => finish({ items: [contact('ou_old')], has_more: false, page_token: '', selection_expires_in: 900 }))
  expect(text(view)).not.toContain('ou_old')
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('an empty intermediate page has a next-page action without claiming no matches', async () => {
  jest.mocked(feishuContacts).mockResolvedValue({ items: [], has_more: true, page_token: 'next', selection_expires_in: 900 })
  await mount(); await search()
  expect(button(view, '读取下一页联系人')).toBeDefined()
  expect(text(view)).not.toContain('没有匹配的联系人')
})


test('temporary verification does not masquerade as missing contacts and cannot submit', async () => {
  jest.mocked(feishuApi).mockResolvedValueOnce({ ...status, connected: false, connection_state: 'service_unavailable', grant_state: 'unavailable', capabilities: { contact_search: false } });
  await mount();
  expect(text(view)).toContain('联系人能力暂时无法核验');
  expect(text(view)).not.toContain('尚未授予联系人搜索权限');
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(true);
  expect(publishToFeishu).not.toHaveBeenCalled();
  await act(async () => button(view, '重新核验飞书连接').props.onPress());
  expect(feishuApi).toHaveBeenCalledWith('/status', {}, 'owner');
  expect(publishToFeishu).not.toHaveBeenCalled();
});
