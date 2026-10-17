import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Linking, ScrollView } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { FeishuDeliveryPanel } from '../src/components/FeishuDeliveryPanel'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { FeishuDestinationPicker } from '../src/components/FeishuDestinationPicker'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { feishuApi, deliveryStatus, publishToFeishu, retryDelivery } from '../src/lib/feishu'
import { connectorPluginKey } from '../src/lib/connectorPlugins'
import * as Plugins from '../src/lib/connectorPlugins'
import { integrationJson } from '../src/lib/integration'
import { newPublishDraft, persistPublishDraft, readPublishDraft } from '../src/lib/feishuPublishReceipt'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import type { Note } from '../src/types/api'
import { readAccountId } from '../src/lib/storage'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: () => 'new-operation', integrationJson: jest.fn(), IntegrationError: class extends Error {} }))
jest.mock('../src/lib/feishu', () => {
  const actual = jest.requireActual('../src/lib/feishu')
  return { ...actual, feishuApi: jest.fn(), deliveryStatus: jest.fn(), publishToFeishu: jest.fn(actual.publishToFeishu), retryDelivery: jest.fn() }
})
const note = { id: 'saved', title: '已保存会议', content: '# 原正文' } as Note
const position = { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_attempt_create: true, can_create: true }
let status: any, view: Renderer.ReactTestRenderer | undefined
const button = (title: string) => view!.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!
const text = () => JSON.stringify(view!.toJSON())
const expand = async (title: string) => { await act(async () => view!.root.findAll(node => node.props.accessibilityLabel === title && typeof node.props.onPress === 'function')[0].props.onPress()) }
async function mount(sheet = false) { await act(async () => { view = Renderer.create(sheet ? <BottomActionSheet visible title="发布" onClose={() => {}}><FeishuDeliveryPanel note={note} /></BottomActionSheet> : <FeishuDeliveryPanel note={note} />) }) }
async function enabled() { await Storage.setItem(connectorPluginKey('owner'), JSON.stringify({ version: 1, feishu: { installed: true, enabled: true } })) }
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('owner'); transitionIdentity('owner')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  status = { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, expired: false, name: '已授权用户', notify_self: false, groups: [] }
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  jest.mocked(feishuApi).mockImplementation(async path => path === '/status' ? status : path === '/groups' ? [{ chat_id: 'group', name: '项目群' }] : position)
  jest.mocked(integrationJson).mockResolvedValue({ id: 'job', operation_id: 'new-operation', status: 'completed', document_url: 'https://example.test/doc', recipients: {} })
})
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined })

test('explicit inline plugin enable reuses existing authorization, then single click submits saved snapshot', async () => {
  await mount()
  expect(await Storage.getItem(connectorPluginKey('owner'))).toBeNull()
  expect(button('创建文档').props.disabled).toBe(true)
  expect((await readPublishDraft('owner', note.id))?.state).toBe('draft')
  await act(async () => button('启用飞书插件').props.onPress())
  expect(JSON.parse((await Storage.getItem(connectorPluginKey('owner')))!).feishu).toEqual({ installed: true, enabled: true })
  expect(button('创建文档').props.disabled).toBe(false)
  expect(integrationJson).not.toHaveBeenCalled()
  await act(async () => button('创建文档').props.onPress())
  expect(integrationJson).toHaveBeenCalledTimes(1)
  const [path, init] = jest.mocked(integrationJson).mock.calls[0]
  expect(path).toBe('/api/feishu/deliveries')
  expect(JSON.parse(init!.body as string)).toMatchObject({ note_key: 'publish:saved', source_mode: 'local_snapshot', content: '# 原正文' })
  expect(jest.mocked(feishuApi).mock.calls.some(([path]) => path.includes('authorize'))).toBe(false)
})

test('default recipients remain visible while controls are collapsed and footer is outside scrolling content', async () => {
  await enabled(); status.notify_self = true; status.groups = ['group']
  await mount(true)
  expect(text()).toContain('通知 · 已授权用户（本人）、项目群')
  expect(text()).toContain('项目群')
  expect(view!.root.findAllByType(PrimaryButton).filter(node => node.props.title === '创建并通知')).toHaveLength(1)
  const scrolling = view!.root.findByType(ScrollView)
  expect(scrolling.findAllByType(PrimaryButton).some(node => node.props.title === '创建并通知')).toBe(false)
  expect((await readPublishDraft('owner', note.id))?.options.recipient_access_policy).toBe('grant_view_and_notify')
})

test('self-only default names the connected person while advanced recipient controls stay collapsed', async () => {
  await enabled(); status.notify_self = true
  await mount()
  expect(text()).toContain('通知 · 已授权用户（本人）')
  expect(view!.root.findAllByType(PrimaryButton).some(node => node.props.title === '搜索联系人')).toBe(false)
  expect(view!.root.findAllByType(PrimaryButton).some(node => node.props.title === '读取本次可选群')).toBe(false)
  await expand('通知 · 已授权用户（本人）')
  expect(button('搜索联系人')).toBeDefined()
  expect(button('读取本次可选群')).toBeDefined()
  expect(integrationJson).not.toHaveBeenCalled()
})

test('ready publication shows one recipient summary with snapshot explanations folded and no export', async () => {
  await enabled(); status.notify_self = true; await mount()
  expect(text()).not.toContain('此次发布固定正文')
  expect(text()).not.toContain('保留原发布选择')
  expect(text()).not.toContain('群成员身份不代表可读文档')
  expect(button('导出 Markdown 文件')).toBeUndefined()
  const visibleText = view!.root.findAll(node => String(node.type) === 'Text').flatMap(node => [node.props.children].flat(Infinity)).join(' ')
  expect(visibleText.split('已授权用户（本人）')).toHaveLength(2)
  await expand('发布详情')
  expect(text()).toContain('此次发布固定正文')
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('exact completed receipt replaces create with open; a changed owner or epoch cannot open the old result', async () => {
  await enabled(); await mount()
  await act(async () => button('创建文档').props.onPress())
  const open = button('打开飞书文档')
  const pressOriginal = open.props.onPress
  expect(open).toBeDefined()
  expect(button('创建文档')).toBeUndefined()
  expect(button('查看飞书文档')).toBeUndefined()
  expect(button('准备发布当前已保存版本')).toBeDefined()
  const link = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  try {
    await act(async () => pressOriginal())
    expect(link).toHaveBeenCalledTimes(1)
    link.mockClear(); jest.mocked(readAccountId).mockResolvedValue('other')
    await act(async () => pressOriginal())
    expect(link).not.toHaveBeenCalled()
    jest.mocked(readAccountId).mockResolvedValue('owner')
    await act(async () => { transitionIdentity('other'); transitionIdentity('owner') })
    await act(async () => pressOriginal())
    expect(link).not.toHaveBeenCalled()
    expect(publishToFeishu).toHaveBeenCalledTimes(1)
  } finally { link.mockRestore() }
})

test.each(['latest-only', 'wrong-receipt', 'unknown'])('completed latest cannot become an acknowledged open button: %s', async scenario => {
  await enabled()
  const completed: any = { id: 'job', status: 'completed', document_url: 'https://example.test/doc', recipients: {} }
  jest.mocked(deliveryStatus).mockResolvedValue(completed)
  if (scenario !== 'latest-only') {
    const draft = newPublishDraft('owner', note.id, { title: note.title, content: note.content }, {})
    await persistPublishDraft({ ...draft, state: scenario === 'unknown' ? 'unknown' : 'acknowledged', ...(scenario === 'wrong-receipt' ? { jobId: 'original-job' } : {}) })
    jest.mocked(integrationJson).mockResolvedValue(completed)
  }
  await mount()
  expect(button('打开飞书文档')).toBeUndefined()
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('failed automatic readonly check offers inline retry without any publish or extra confirmation', async () => {
  await enabled()
  jest.mocked(feishuApi).mockImplementation(async path => { if (path === '/destinations/check') throw new Error('位置暂不可读'); return status })
  await mount()
  expect(button('创建文档').props.disabled).toBe(true)
  expect(text()).toContain('位置暂不可读')
  jest.mocked(feishuApi).mockImplementation(async path => path === '/status' ? status : position)
  await act(async () => button('重试读取位置与通知对象').props.onPress())
  expect(button('创建文档').props.disabled).toBe(false)
  expect(publishToFeishu).not.toHaveBeenCalled()
})

test('late plugin disable before HTTP restores this exact operation instead of stranding unknown', async () => {
  await enabled(); await mount()
  const original = await readPublishDraft('owner', note.id)
  const read = jest.mocked(Storage.getItem).getMockImplementation()!
  let pluginReads = 0
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    if (key === connectorPluginKey('owner') && ++pluginReads === 2) return JSON.stringify({ version: 1, feishu: { installed: true, enabled: false } })
    return read(key)
  })
  try { await act(async () => button('创建文档').props.onPress()) } finally { jest.mocked(Storage.getItem).mockImplementation(read) }
  expect(integrationJson).not.toHaveBeenCalled()
  expect((await readPublishDraft('owner', note.id))).toMatchObject({ state: 'draft', operationId: original!.operationId, publicationKey: original!.publicationKey })
  expect(button('启用飞书插件')).toBeDefined()
})

test('owner epoch changes cancel explicit enabling before plugin storage mutation', async () => {
  await mount()
  const create = Plugins.createConnectorPluginStore
  let finish!: () => void
  const wait = new Promise<void>(resolve => { finish = resolve })
  const spy = jest.spyOn(Plugins, 'createConnectorPluginStore').mockImplementation(storage => {
    const store = create(storage)
    return { ...store, save: async (...args) => { await wait; return store.save(...args) } }
  })
  try {
    await act(async () => { void button('启用飞书插件').props.onPress() })
    await act(async () => { transitionIdentity('other'); transitionIdentity('owner'); finish() })
    expect(await Storage.getItem(connectorPluginKey('owner'))).toBeNull()
    expect(integrationJson).not.toHaveBeenCalled()
  } finally { spy.mockRestore() }
})

test('late position response cannot approve a newer destination', async () => {
  await enabled(); await mount(); await expand('更改位置')
  let finish!: (value: unknown) => void
  jest.mocked(feishuApi).mockImplementation(async (path, init) => {
    if (path === '/status') return status
    if (String(init?.body).includes('first')) return new Promise(resolve => { finish = resolve })
    return { ...position, name: '第二位置', path: ['第二位置'] }
  })
  const picker = view!.root.findByType(FeishuDestinationPicker)
  await act(async () => picker.props.onChange({ kind: 'folder', folder_token: 'first' }))
  expect(button('创建文档').props.disabled).toBe(true)
  await act(async () => picker.props.onChange({ kind: 'folder', folder_token: 'second' }))
  await act(async () => finish({ ...position, name: '过时位置', path: ['过时位置'] }))
  expect(text()).toContain('第二位置'); expect(text()).not.toContain('过时位置')
  expect(button('创建文档').props.disabled).toBe(false)
})

test('new external recipients require access protocol; self-only continues on older service', async () => {
  await enabled(); status.groups = ['group']; delete status.recipient_access_protocol
  await mount()
  expect(button('创建并通知').props.disabled).toBe(true)
  expect(text()).toContain('升级收件人阅读权限协议')
  expect((await readPublishDraft('owner', note.id))?.state).toBe('draft')
  await act(async () => view!.unmount()); view = undefined
  for (const key of await Storage.getAllKeys()) if (key.includes('feishu-publish')) await Storage.removeItem(key)
  status.groups = []; status.notify_self = true
  await mount()
  expect(button('创建并通知').props.disabled).toBe(false)
  expect((await readPublishDraft('owner', note.id))?.options.recipient_access_policy).toBeUndefined()
})

test.each(['permission_unknown', 'reading_unknown'])('uncertain recipient %s is query-only, including failed-step callbacks', async kind => {
  await enabled()
  const draft = { ...newPublishDraft('owner', note.id, { title: note.title, content: note.content }, {}), state: 'acknowledged' as const, jobId: 'job' }
  await persistPublishDraft(draft)
  jest.mocked(integrationJson).mockResolvedValue({ id: 'job', status: 'failed', phase: 'partial_success', recipients: { external: { name: '收件人', status: kind === 'permission_unknown' ? kind : 'failed', reading_permission: { status: 'unknown' } } } })
  await mount()
  expect(button('查询原发布任务')).toBeDefined()
  expect(button('重试失败步骤').props.disabled).toBe(true)
  await act(async () => button('重试失败步骤').props.onPress())
  expect(retryDelivery).not.toHaveBeenCalled()
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(jest.mocked(integrationJson).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

test.each([false, true])('permission verification is read-only and requires explicit continuation; message unknown=%s', async messageUnknown => {
  await enabled()
  const draft = { ...newPublishDraft('owner', note.id, { title: note.title, content: note.content }, { groups: ['group'] }), state: 'acknowledged' as const, jobId: 'job' }
  await persistPublishDraft(draft)
  const result: any = { id: 'job', status: 'failed', recipient_access_policy: 'grant_view_and_notify', phase: messageUnknown ? 'unknown' : 'permission_unknown', recipients: {
    group: { name: '项目群', status: 'permission_unknown', reading_permission: { status: 'unknown' } },
    ...(messageUnknown ? { message: { name: '另一通知', status: 'unknown' } } : {}),
  } }
  jest.mocked(integrationJson).mockResolvedValue(result)
  await mount()
  jest.mocked(integrationJson).mockClear()
  jest.mocked(integrationJson).mockResolvedValue({ ...result, phase: messageUnknown ? 'unknown' : 'partial_success', recipients: { ...result.recipients, group: { name: '项目群', status: 'pending', reading_permission: { status: 'verified' } } } })
  await act(async () => button('核验阅读权限').props.onPress())
  expect(jest.mocked(integrationJson).mock.calls.map(([path]) => path)).toEqual(['/api/feishu/deliveries/job/verify-permissions'])
  expect(retryDelivery).not.toHaveBeenCalled()
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(button('继续通知').props.disabled).toBe(messageUnknown)
  if (!messageUnknown) {
    jest.mocked(retryDelivery).mockResolvedValue({ ...result, phase: 'notifying' })
    await act(async () => button('继续通知').props.onPress())
    expect(retryDelivery).toHaveBeenCalledTimes(1)
    expect(retryDelivery).toHaveBeenCalledWith('job', undefined, 'owner')
  }
})
