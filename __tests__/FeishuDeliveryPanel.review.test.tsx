import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import Storage from '@react-native-async-storage/async-storage'
import { FeishuDeliveryPanel } from '../src/components/FeishuDeliveryPanel'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { SettingsCheckbox } from '../src/components/SettingsCheckbox'
import { deliveryStatus, deliveryByOperation, publishToFeishu, retryDelivery, feishuApi } from '../src/lib/feishu'
import { readPublishDraft } from '../src/lib/feishuPublishReceipt'
import type { Note } from '../src/types/api'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: jest.fn(() => 'frozen-op') }))
jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, feishuPublishBody: jest.requireActual('../src/lib/feishu').feishuPublishBody, feishuContacts: jest.fn(), contactsValid: (items: any[]) => items.every(item => !!item.name && item.expiresAt > Date.now()), contactRecipients: (items: any[]) => items.map(({ open_id, selection_token }) => ({ open_id, selection_token })), feishuApi: jest.fn(), deliveryStatus: jest.fn(), deliveryById: jest.fn(), deliveryByOperation: jest.fn(), assertFeishuPublishReady: jest.fn(async () => {}), publishToFeishu: jest.fn(), retryDelivery: jest.fn(), recoverDeliveryDocument: jest.fn() }))
const note = { id: 'note', title: '原文', content: '冻结正文', workspace_key: 'key', workspace_version_id: 'v2', workspace_revision: 2 } as Note

test('unavailable verification disables selected failed group retry and retains the exact group result', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => path === '/status'
    ? { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, grant_state: 'unavailable', groups: [], notify_self: false }
    : api(path, ...args))
  jest.mocked(deliveryStatus).mockResolvedValue({ id: 'original-job', status: 'failed', phase: 'partial_success', recipients: { oc_original: { name: '原项目群', status: 'failed' } } } as any)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(button(view, '仅重试 原项目群').props.disabled).toBe(true)
  expect(text(view)).toContain('原项目群')
  expect(text(view)).toContain('暂时无法核验飞书连接')
  await act(async () => button(view, '仅重试 原项目群').props.onPress())
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(retryDelivery).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
const button = (view: Renderer.ReactTestRenderer, title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
const confirm = (view: Renderer.ReactTestRenderer) => view.root.findAllByType(SettingsCheckbox).find(node => node.props.label === '已核对内容、位置与通知对象')!
const text = (view: Renderer.ReactTestRenderer) => view.root.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text').flatMap(node => [node.props.children].flat(Infinity)).filter(value => typeof value === 'string' || typeof value === 'number').join(' ')
beforeEach(async () => {
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.clearAllMocks()
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  jest.mocked(feishuApi).mockImplementation(async path => {
    if (path === '/status') return { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, expired: false, name: '用户甲', notify_self: true, groups: ['g1', 'g2'], destination_config: { kind: 'folder', folder_token: 'folder' }, permission_policy: 'inherit' }
    if (path === '/groups') return [{ chat_id: 'g1', name: '研发群' }, { chat_id: 'g2', name: '产品群' }]
    return { name: '项目资料', path: ['项目资料'], path_complete: false, can_attempt_create: true, can_create: false }
  })
})
test('only real names and location permit confirmation; unknown reopens original frozen evidence despite changed defaults', async () => {
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(false)
  expect(text(view)).toContain('研发群'); expect(text(view)).toContain('产品群'); expect(text(view)).toContain('用户甲（本人）')
  expect(text(view)).toContain('已核验路径片段'); expect(text(view)).toContain('完整祖先路径未核验')
  expect(text(view)).not.toContain('群成员身份不代表可读文档')
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '发布详情' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(text(view)).toContain('群成员身份不代表可读文档')
  jest.mocked(publishToFeishu).mockRejectedValue(new Error('发布回执丢失'))
  await act(async () => button(view, '创建飞书文档并通知').props.onPress())
  const original = await readPublishDraft('owner', 'key')
  expect(original).toMatchObject({ state: 'unknown', operationId: 'frozen-op', review: { selfName: '用户甲', groups: [{ chat_id: 'g1', name: '研发群' }, { chat_id: 'g2', name: '产品群' }], destination: { path: ['项目资料'], path_complete: false } } })
  expect(jest.mocked(publishToFeishu).mock.calls[0][5]).not.toHaveProperty('review')
  await act(async () => view.unmount())
  jest.mocked(feishuApi).mockImplementation(async () => ({ publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, name: '另一个姓名', notify_self: false, groups: ['different'], destination_config: { kind: 'personal' } }))
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('精确回执暂不可用'))
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={{ ...note, title: '新版', content: '不同正文' }} />) })
  expect(text(view)).toContain('研发群'); expect(text(view)).toContain('产品群'); expect(text(view)).toContain('用户甲（本人）'); expect(text(view)).toContain('项目资料')
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(true)
  expect(await readPublishDraft('owner', 'key')).toEqual(original)
  expect(publishToFeishu).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})
test('group failure leaves confirmation disabled and offers explicit reread without POST', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => { if (path === '/groups') throw new Error('群读取失败'); return api(path, ...args) })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(text(view)).toContain('发布对象未核验：群读取失败')
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(true)
  expect(button(view, '创建飞书文档并通知').props.disabled).toBe(true)
  expect(button(view, '重试读取位置与通知对象')).toBeDefined()
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
test('no selected notifications states no sending and never loads a group directory', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => path === '/status' ? { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, name: '用户甲', notify_self: false, groups: [], destination_config: { kind: 'personal' } } : api(path, ...args))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(text(view)).toContain('通知 · 不发送')
  expect(feishuApi).not.toHaveBeenCalledWith('/groups', {}, 'owner')
  await act(async () => view.unmount())
})
