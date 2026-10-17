import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FeishuDocumentFooter } from '../src/components/FeishuDocumentFooter'
import { deliveryById, deliveryByOperation, deliveryStatus, publishToFeishu, retryDelivery, type Delivery } from '../src/lib/feishu'
import Storage from '@react-native-async-storage/async-storage'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { readAccountId } from '../src/lib/storage'
import { newPublishDraft, persistPublishDraft, readPublishDraft } from '../src/lib/feishuPublishReceipt'
import { beginRetryReceipt, readRetryReceipt } from '../src/lib/feishuRetryReceipt'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: () => 'original-operation' }))
jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, deliveryStatus: jest.fn(), deliveryById: jest.fn(), deliveryByOperation: jest.fn(), publishToFeishu: jest.fn(), retryDelivery: jest.fn() }))
const job: Delivery = { id: 'original-job', status: 'completed', document_url: 'https://company.feishu.cn/docx/approved', error: '', recipients: {} }
let view: Renderer.ReactTestRenderer
const props = { noteId: 'note-a', refreshKey: '1', onDelivery: jest.fn(), onSettings: jest.fn() }
const action = (text: string) => view.root.findAll(node => typeof node.props.onPress === 'function' && node.findAll(child => child.props.children === text).length > 0)[0]
const verify = () => finishVerification(beginVerification('A'), 'verified')
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('A'); transitionIdentity('A'); verify()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
afterEach(async () => {
  expect(publishToFeishu).not.toHaveBeenCalled(); expect(retryDelivery).not.toHaveBeenCalled()
  if (view) await act(async () => view.unmount())
})

test('no publication has no second publish entrance below the body', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  expect(view.toJSON()).toBeNull()
})
test('an unknown result only opens status and does not advertise retry', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue({ ...job, status: 'failed', phase: 'unknown', error: '写入结果无法确认' })
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  expect(view.root.findAll(node => node.props.children === '飞书文档 · 发布结果待核验').length).toBeGreaterThan(0)
  await act(async () => action('查看发布状态').props.onPress())
  expect(props.onDelivery).toHaveBeenCalledTimes(1)
  expect(view.root.findAll(node => node.props.children === '通知需处理 · 查看并重试')).toHaveLength(0)
  expect(deliveryStatus).toHaveBeenCalledTimes(1)
})
test('a failed refresh retains the known document and does not route a network failure to settings', async () => {
  jest.mocked(deliveryStatus).mockResolvedValueOnce(job).mockRejectedValueOnce(new Error('网络暂时不可用'))
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => view.update(<FeishuDocumentFooter {...props} refreshKey="2" />))
  expect(view.root.findAll(node => node.props.children === '飞书文档 · 已发布 · 更新未确认').length).toBeGreaterThan(0)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '查看已发布飞书文档').length).toBeGreaterThan(0)
  expect(view.root.findAll(node => node.props.children === '检查飞书连接')).toHaveLength(0)
})
test('a status read failure retries the read and preserves its content scope', async () => {
  jest.mocked(deliveryStatus).mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValueOnce(null)
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => action('重新读取').props.onPress())
  expect(deliveryStatus).toHaveBeenNthCalledWith(2, 'note-a', 'A')
  expect(props.onDelivery).not.toHaveBeenCalled()
  expect(view.toJSON()).toBeNull()
})
test('switching content does not retain a different document on a failed read', async () => {
  jest.mocked(deliveryStatus).mockResolvedValueOnce(job).mockRejectedValueOnce(new Error('网络暂时不可用'))
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => view.update(<FeishuDocumentFooter {...props} noteId="note-b" />))
  expect(view.root.findAll(node => node.props.accessibilityLabel === '查看已发布飞书文档')).toHaveLength(0)
})

const formatting = { protocol: 'feishu-markdown-selective-v2', status: 'written', native_write_confirmed: true, native_required: ['table', 'code', 'inline'] }
async function savedReceipt(state: 'unknown' | 'acknowledged' = 'acknowledged') {
  const draft = { ...newPublishDraft('A', 'note-a', { title: '原标题', content: '固定原正文', revisionId: '2' }, { notify_self: false, groups: [] }), state, ...(state === 'acknowledged' ? { jobId: job.id } : {}) }
  await persistPublishDraft(draft)
  return draft
}

test('checking on mount recovers exact frozen job only after the same epoch becomes verified', async () => {
  const original = await savedReceipt()
  pauseRemote()
  jest.mocked(deliveryById).mockResolvedValue({ ...job, formatting })
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  expect(deliveryById).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('账号尚未核验')
  await act(async () => verify())
  expect(deliveryById).toHaveBeenCalledWith(job.id, 'A')
  expect(deliveryStatus).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('原生表格、代码块、行内样式已确认写入')
  expect(await readPublishDraft('A', 'note-a')).toEqual(original)
})

test('in-flight old lease cannot overwrite the recovered exact GET result', async () => {
  await savedReceipt()
  let finish!: (value: Delivery) => void
  jest.mocked(deliveryById).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ...job, formatting })
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => pauseRemote())
  await act(async () => verify())
  expect(deliveryById).toHaveBeenCalledTimes(2)
  await act(async () => finish({ ...job, status: 'failed', error: '过期 GET 结果' }))
  expect(JSON.stringify(view.toJSON())).not.toContain('过期 GET 结果')
  expect(JSON.stringify(view.toJSON())).toContain('已确认写入')
})

test('unknown operation 404 never falls back, acknowledges, changes snapshot or POSTs', async () => {
  const original = await savedReceipt('unknown')
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('404 原结果待核验'))
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => pauseRemote())
  await act(async () => verify())
  expect(deliveryByOperation).toHaveBeenCalledTimes(2)
  expect(deliveryByOperation).toHaveBeenLastCalledWith(original.operationId, 'A')
  expect(deliveryStatus).not.toHaveBeenCalled()
  expect(await readPublishDraft('A', 'note-a')).toEqual(original)
  expect(JSON.stringify(view.toJSON())).toContain('飞书发布结果待核验')
  expect(JSON.stringify(view.toJSON())).not.toContain('已确认写入')
})

test('pending retry exact GET cannot clear pending even for a completed rich-format result', async () => {
  const original = await savedReceipt()
  const pending = await beginRetryReceipt('A', 'note-a', job.id)
  jest.mocked(deliveryById).mockResolvedValue({ ...job, formatting })
  jest.mocked(Storage.setItem).mockClear(); jest.mocked(Storage.removeItem).mockClear()
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => pauseRemote())
  await act(async () => verify())
  expect(deliveryById).toHaveBeenLastCalledWith(job.id, 'A')
  expect(await readRetryReceipt('A', 'note-a')).toEqual(pending)
  expect(await readPublishDraft('A', 'note-a')).toEqual(original)
  expect(Storage.setItem).not.toHaveBeenCalled(); expect(Storage.removeItem).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('正文格式尚未核验')
  expect(JSON.stringify(view.toJSON())).not.toContain('已确认写入')
})

test('wrong exact receipt ID remains unconfirmed and never substitutes latest', async () => {
  await savedReceipt()
  jest.mocked(deliveryById).mockResolvedValue({ ...job, id: 'other-job', formatting })
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  expect(JSON.stringify(view.toJSON())).toContain('不属于原发布操作')
  expect(JSON.stringify(view.toJSON())).not.toContain('已确认写入')
  expect(deliveryStatus).not.toHaveBeenCalled()
})

test('A-B-A cannot rebind the open footer or adopt a delayed result', async () => {
  await savedReceipt()
  let finish!: (value: Delivery) => void
  jest.mocked(deliveryById).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => { transitionIdentity('B'); transitionIdentity('A'); verify() })
  await act(async () => finish({ ...job, formatting }))
  expect(deliveryById).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(view.toJSON())).toContain('账号已切换')
  expect(JSON.stringify(view.toJSON())).not.toContain('已确认写入')
  expect(view.root.findAll(node => node.props.accessibilityLabel === '查看已发布飞书文档')).toHaveLength(0)
})

test('legacy latest result is pinned to exact job for gate recovery with format still unverified', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue({ ...job, formatting })
  jest.mocked(deliveryById).mockResolvedValue({ ...job, formatting })
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => pauseRemote())
  await act(async () => verify())
  expect(deliveryStatus).toHaveBeenCalledTimes(1)
  expect(deliveryById).toHaveBeenCalledWith(job.id, 'A')
  expect(JSON.stringify(view.toJSON())).toContain('正文格式尚未核验')
})

test('gate recovery does not replace the pinned publication with a newer draft pointer', async () => {
  await savedReceipt()
  jest.mocked(deliveryById).mockResolvedValue(job)
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => pauseRemote())
  const newer = { ...newPublishDraft('A', 'note-a', { title: '后来标题', content: '后来草稿' }, { notify_self: true, groups: [] }), operationId: 'new-operation' }
  await persistPublishDraft(newer)
  await act(async () => verify())
  expect(deliveryById).toHaveBeenNthCalledWith(2, job.id, 'A')
  expect(deliveryByOperation).not.toHaveBeenCalled(); expect(deliveryStatus).not.toHaveBeenCalled()
  expect(await readPublishDraft('A', 'note-a')).toEqual(newer)
})

test('changing note discards delayed original receipt and does not expose its document', async () => {
  await savedReceipt()
  let finish!: (value: Delivery) => void
  jest.mocked(deliveryById).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  jest.mocked(deliveryStatus).mockRejectedValueOnce(new Error('新内容状态读取失败'))
  await act(async () => { view = Renderer.create(<FeishuDocumentFooter {...props} />) })
  await act(async () => view.update(<FeishuDocumentFooter {...props} noteId="note-b" />))
  await act(async () => finish({ ...job, formatting }))
  expect(JSON.stringify(view.toJSON())).toContain('新内容状态读取失败')
  expect(view.root.findAll(node => node.props.accessibilityLabel === '查看已发布飞书文档')).toHaveLength(0)
})
