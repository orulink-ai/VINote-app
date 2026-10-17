import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FeishuDeliveryPanel } from '../src/components/FeishuDeliveryPanel'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { deliveryStatus, publishToFeishu, feishuApi } from '../src/lib/feishu'
import { SettingsCheckbox } from '../src/components/SettingsCheckbox'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, feishuPublishBody: jest.requireActual('../src/lib/feishu').feishuPublishBody, feishuContacts: jest.fn(), contactsValid: (items: any[]) => items.every(item => !!item.name && item.expiresAt > Date.now()), contactRecipients: (items: any[]) => items.map(({ open_id, selection_token }) => ({ open_id, selection_token })), feishuApi: jest.fn(), deliveryStatus: jest.fn(), assertFeishuPublishReady: jest.fn(async () => {}), publishToFeishu: jest.fn(), retryDelivery: jest.fn(), recoverDeliveryDocument: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
afterEach(() => jest.clearAllMocks())
const note = { id: 'note-1', title: '会议', content: '# 纪要' } as Note

test('cannot publish before status is read, and retry recovers a failed read', async () => {
  jest.mocked(feishuApi).mockImplementation(async path => path === '/status' ? { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, expired: false, notify_self: false, groups: [] } : { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_create: true, can_attempt_create: true })
  let fail!: (cause: Error) => void
  jest.mocked(deliveryStatus).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject })).mockResolvedValueOnce(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const publish = () => view.root.findAllByType(PrimaryButton).find(node => ['创建文档', '创建并通知'].includes(node.props.title))!
  expect(publish().props.disabled).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain('正在读取交付状态')
  await act(async () => fail(new Error('暂时断网')))
  expect(publish().props.disabled).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain('读取失败')
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '重新加载交付状态')!.props.onPress())
  expect(publish().props.disabled).toBe(false)
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
