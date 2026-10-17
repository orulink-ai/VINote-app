import { exportNoteFile } from '../src/lib/notes'
import { SettingsCheckbox } from '../src/components/SettingsCheckbox'
import React from 'react'
import { Pressable } from 'react-native'
import Renderer, { act } from 'react-test-renderer'
import Storage from '@react-native-async-storage/async-storage'
import { FeishuDeliveryPanel } from '../src/components/FeishuDeliveryPanel'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { newPublishDraft, persistPublishDraft, readPublishDraft } from '../src/lib/feishuPublishReceipt'
import { assertFeishuPublishReady, deliveryById, retryDelivery, deliveryByOperation, deliveryStatus, publishToFeishu, feishuApi } from '../src/lib/feishu'
import { beginRetryReceipt, readRetryReceipt } from '../src/lib/feishuRetryReceipt'
import { FeishuDestinationPicker } from '../src/components/FeishuDestinationPicker'
import { MeetingMarkdown } from '../src/components/MeetingMarkdown'
import type { Note } from '../src/types/api'
jest.mock('../src/components/MeetingMarkdown', () => ({ MeetingMarkdown: () => null }))
jest.mock('../src/lib/notes', () => ({ exportNoteFile: jest.fn(async () => {}) }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example', operationId: jest.fn(() => 'original-op') }))
jest.mock('../src/lib/feishu', () => ({ newSnapshotPublishOptions: jest.requireActual('../src/lib/feishu').newSnapshotPublishOptions, feishuPublishBody: jest.requireActual('../src/lib/feishu').feishuPublishBody,
  feishuContacts: jest.fn(), contactsValid: (items: any[]) => items.every(item => !!item.name && item.expiresAt > Date.now()), contactRecipients: (items: any[]) => items.map(({ open_id, selection_token }) => ({ open_id, selection_token })), feishuApi: jest.fn(async () => ({ configured: true, connected: true, notify_self: true, groups: ['different-group'] })),
  deliveryStatus: jest.fn(), deliveryById: jest.fn(), deliveryByOperation: jest.fn(), assertFeishuPublishReady: jest.fn(async () => {}), publishToFeishu: jest.fn(), retryDelivery: jest.fn(), recoverDeliveryDocument: jest.fn(),
}))
const note = { id: 'note', title: '最新标题', content: '新正文', workspace_key: 'key', workspace_version_id: 'v3', workspace_revision: 3 } as Note
beforeEach(async () => {
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.clearAllMocks()
  jest.mocked(assertFeishuPublishReady).mockResolvedValue(undefined)
  jest.mocked(feishuApi).mockImplementation(async () => ({ configured: true, connected: true, notify_self: true, groups: ['different-group'] }))
})
test('old public 404 cannot unlock unknown on open, refresh, or remount; defaults and latest never replace original', async () => {
  const original = { ...newPublishDraft('owner', 'key', { title: '原冻结标题', content: '原正文', versionId: 'v2', revisionId: '2' }, { destination_config: { kind: 'personal' }, notify_self: false, groups: [] }), state: 'unknown' as const }
  await persistPublishDraft(original)
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('精确回执接口尚未可用（404）'))
  jest.mocked(deliveryStatus).mockResolvedValue({ id: 'other', status: 'completed', document_url: '', recipients: {}, error: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
  expect(button('创建飞书文档并通知').props.disabled).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain('提交结果待核验')
  expect(JSON.stringify(view.toJSON())).not.toContain('尚未交付到飞书')
  await act(async () => button('创建飞书文档并通知').props.onPress())
  await act(async () => button('重新加载交付状态').props.onPress())
  expect(deliveryStatus).not.toHaveBeenCalled(); expect(publishToFeishu).not.toHaveBeenCalled()
  expect(await readPublishDraft('owner', 'key')).toMatchObject({ operationId: 'original-op', state: 'unknown', snapshot: { content: '原正文', revisionId: '2' }, options: { notify_self: false, groups: [] } })
  await act(async () => view.unmount())
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(button('创建飞书文档并通知').props.disabled).toBe(true)
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
test('old server without explicit protocol capability blocks even a manually invoked publish callback', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const publish = view.root.findAllByType(PrimaryButton).find(node => ['创建文档', '创建并通知'].includes(node.props.title))!
  expect(publish.props.disabled).toBe(true)
  await act(async () => publish.props.onPress())
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect((await readPublishDraft('owner', 'key'))?.state).toBe('draft')
  await act(async () => view.unmount())
})

test('unverified account or unreadable status is not reported as an outdated service protocol', async () => {
  jest.mocked(feishuApi).mockRejectedValue(new Error('账号尚未核验，远端操作暂不可用；本机内容与草稿仍保留'))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const contents = JSON.stringify(view.toJSON())
  expect(contents).toContain('账号尚未核验')
  expect(contents).not.toContain('飞书服务需要升级发布回执协议')
  expect(view.root.findAllByType(PrimaryButton).find(node => ['创建文档', '创建并通知'].includes(node.props.title))!.props.disabled).toBe(true)
  expect(deliveryStatus).not.toHaveBeenCalled()
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('capability disappearing after open is checked before intent dispatch or POST', async () => {
  jest.mocked(feishuApi).mockImplementation(async () => ({ publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, notify_self: false, groups: [] }))
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  jest.mocked(feishuApi).mockImplementation(async () => ({ configured: true, connected: true, notify_self: false, groups: [] }))
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => ['创建文档', '创建并通知'].includes(node.props.title))!.props.onPress())
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect((await readPublishDraft('owner', 'key'))?.state).toBe('draft')
  await act(async () => view.unmount())
})

test('restored current-body r1 is labelled fixed rather than latest when the current note is r3', async () => {
  const draft = newPublishDraft('owner', 'key', { title: '冻结标题', content: '冻结r1正文', versionId: '__vinote:current:r1', revisionId: '1' }, { destination_config: { kind: 'personal' }, notify_self: false, groups: [] });
  await persistPublishDraft(draft); jest.mocked(deliveryStatus).mockResolvedValue(null);
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) });
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '发布详情' && typeof node.props.onPress === 'function')[0].props.onPress());
  const text = view.root.findAll(node => typeof node.type === 'string' && String(node.type) === 'Text').flatMap(node => [node.props.children].flat(Infinity)).filter(value => typeof value === 'string' || typeof value === 'number').join('');
  expect(text).toContain('此次发布固定正文 · 保存修订 1');
  expect(text).toContain('保留原发布选择，不会自动换成新内容');
  expect(text).not.toContain('最新已保存正文');
  expect((await readPublishDraft('owner', 'key'))?.snapshot.content).toBe('冻结r1正文');
  expect(publishToFeishu).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});


test('settings departure flushes the same draft and returning clears draft review without POST', async () => {
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  const draft = newPublishDraft('owner', 'key', { title: '冻结草稿', content: '冻结正文' }, { destination_config: { kind: 'personal' }, notify_self: false, groups: ['saved-group'] })
  draft.review = { optionsSignature: 'old-review', groups: [], destination: { name: '旧位置', path: ['旧位置'], path_complete: true, can_create: true } }
  await persistPublishDraft(draft)
  const settings = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} onSettings={settings} />) })
  const manage = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '管理飞书设置')!
  await act(async () => manage.props.onPress())
  expect(settings).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'note', noteKey: 'key', owner: 'owner', operationId: draft.operationId }))
  expect(await readPublishDraft('owner', 'key')).toMatchObject({ operationId: draft.operationId, snapshot: draft.snapshot, options: draft.options })
  expect((await readPublishDraft('owner', 'key'))?.review).toBeUndefined()
  await act(async () => view.unmount())
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} returnedFromSettings />) })
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(feishuApi).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }), expect.anything())
  await act(async () => view.unmount())
})


test.each(['draft', 'unknown', 'acknowledged'] as const)('dedicated publication omits duplicate export for %s and retains the original snapshot', async state => {
  const frozen = { ...newPublishDraft('owner', 'key', { title: '冻结标题', content: '冻结正文', versionId: 'original-version', revisionId: '2' }, { destination_config: { kind: 'personal' }, notify_self: false, groups: [] }), state }
  await persistPublishDraft(frozen)
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  jest.mocked(deliveryByOperation).mockResolvedValue({ id: 'original-job', operation_id: frozen.operationId, status: 'completed', document_url: '', recipients: {}, error: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  await act(async () => view.update(<FeishuDeliveryPanel note={{ ...note, title: '更晚标题', content: '更晚正文', version: 9 }} />))
  const before = await readPublishDraft('owner', 'key')
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '导出 Markdown 文件')).toBe(false)
  expect(before?.snapshot).toMatchObject({ title: '冻结标题', content: '冻结正文' })
  expect(exportNoteFile).not.toHaveBeenCalled()
  expect(await readPublishDraft('owner', 'key')).toEqual(before)
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('publication has no duplicate transcript export and never changes frozen publication body', async () => {
  await persistPublishDraft(newPublishDraft('owner', 'key', { title: '冻结标题', content: '冻结正文', revisionId: '2' }, { notify_self: false, groups: [] }))
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={{ ...note, transcript: { full_text: '当前逐字稿' } } as Note} />) })
  const before = await readPublishDraft('owner', 'key')
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '导出 Markdown 文件')).toBe(false)
  expect(view.root.findAllByType(SettingsCheckbox).some(node => node.props.label.includes('Markdown 导出'))).toBe(false)
  expect(exportNoteFile).not.toHaveBeenCalled()
  expect(await readPublishDraft('owner', 'key')).toEqual(before)
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

async function failedReceipt() {
  await persistPublishDraft({ ...newPublishDraft('owner', 'key', { title: '原标题', content: '原固定正文' }, { notify_self: false, groups: [] }), state: 'acknowledged', jobId: 'original-job' })
  jest.mocked(feishuApi).mockImplementation(async () => ({ publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, notify_self: false, groups: [] }))
  jest.mocked(deliveryById).mockResolvedValue({ id: 'original-job', status: 'failed', phase: 'failed', recipients: {}, document_url: '', error: '' })
}

test.each(['lost response', 'wrong job'] as const)('retry %s freezes original job across refresh and remount without another POST', async outcome => {
  await failedReceipt()
  if (outcome === 'lost response') jest.mocked(retryDelivery).mockImplementation(async () => { expect(await readRetryReceipt('owner', 'key')).toMatchObject({ jobId: 'original-job' }); throw new Error('连接中断，结果未知') })
  else jest.mocked(retryDelivery).mockResolvedValue({ id: 'other-job', status: 'completed', recipients: {}, document_url: '', error: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
  await act(async () => button('重试失败步骤').props.onPress())
  expect(await readRetryReceipt('owner', 'key')).toMatchObject({ jobId: 'original-job', observedRunning: false })
  expect(JSON.stringify(view.toJSON())).toContain('重试结果待核验')
  expect(button('重试失败步骤').props.disabled).toBe(true)
  await act(async () => button('重试失败步骤').props.onPress())
  await act(async () => button('查询原重试任务').props.onPress())
  expect(retryDelivery).toHaveBeenCalledTimes(1)
  expect(deliveryById).toHaveBeenLastCalledWith('original-job', 'owner')
  expect(await readRetryReceipt('owner', 'key')).not.toBeNull()
  await act(async () => view.unmount())
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(button('重试失败步骤').props.disabled).toBe(true)
  await act(async () => button('重试失败步骤').props.onPress())
  expect(retryDelivery).toHaveBeenCalledTimes(1)
  expect(deliveryStatus).not.toHaveBeenCalled()
  expect(publishToFeishu).not.toHaveBeenCalled()
  jest.mocked(deliveryById).mockResolvedValue({ id: 'original-job', status: 'completed', phase: 'completed', recipients: {}, document_url: '', error: '' })
  await act(async () => button('查询原重试任务').props.onPress())
  expect(await readRetryReceipt('owner', 'key')).toBeNull()
  await act(async () => view.unmount())
})

test('retry marker storage failure prevents POST', async () => {
  await failedReceipt()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('无法保存重试记录'))
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '重试失败步骤')!.props.onPress())
  expect(retryDelivery).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('无法保存重试记录')
  await act(async () => view.unmount())
})

test('inline preview shows frozen saved body after current body changes', async () => {
  await failedReceipt()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(view.root.findAllByType(MeetingMarkdown)).toHaveLength(0)
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '预览此次发布正文' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(view.root.findByType(MeetingMarkdown).props.content).toBe('原固定正文')
  await act(async () => view.update(<FeishuDeliveryPanel note={{ ...note, content: '更新后的正文' }} />))
  expect(view.root.findByType(MeetingMarkdown).props.content).toBe('原固定正文')
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})


test('server unknown result keeps an exact query entry without POST', async () => {
  await failedReceipt()
  jest.mocked(deliveryById).mockResolvedValue({ id: 'original-job', status: 'failed', phase: 'unknown', recipients: {}, document_url: '', error: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  expect(JSON.stringify(view.toJSON())).toContain('交付结果待核验')
  const buttons = () => view.root.findAllByType(PrimaryButton)
  expect(buttons().find(node => node.props.title === '重试失败步骤')!.props.disabled).toBe(true)
  await act(async () => buttons().find(node => node.props.title === '查询原发布任务')!.props.onPress())
  expect(deliveryById).toHaveBeenLastCalledWith('original-job', 'owner')
  expect(retryDelivery).not.toHaveBeenCalled()
  expect(deliveryStatus).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test.each(['confirmed', 'new draft', 'unknown operation', 'unknown phase', 'unknown retry', 'legacy source'] as const)('format evidence stays bound to the frozen source: %s', async scenario => {
  const formatting = { protocol: 'feishu-markdown-selective-v2', status: 'written', native_write_confirmed: true, native_required: ['table', 'code', 'inline'] }
  const completed = { id: 'original-job', status: 'completed' as const, phase: scenario === 'unknown phase' ? 'unknown' : 'completed', formatting, recipients: {}, document_url: 'https://example.invalid/doc', error: '' }
  if (scenario !== 'legacy source') {
    const state = scenario === 'new draft' ? 'draft' : scenario === 'unknown operation' ? 'unknown' : 'acknowledged'
    await persistPublishDraft({ ...newPublishDraft('owner', 'key', { title: '原冻结标题', content: '原冻结正文' }, { notify_self: false, groups: [] }), state, ...(state === 'acknowledged' ? { jobId: 'original-job' } : {}) })
  }
  if (scenario === 'unknown retry') await beginRetryReceipt('owner', 'key', 'original-job')
  jest.mocked(feishuApi).mockImplementation(async () => ({ publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, notify_self: false, groups: [] }))
  jest.mocked(deliveryStatus).mockResolvedValue(completed)
  jest.mocked(deliveryById).mockResolvedValue(completed)
  // Unknown dispatch does not inherit even a completed latest job's formatting.
  if (scenario === 'unknown operation') jest.mocked(deliveryByOperation).mockRejectedValue(new Error('结果待核验'))
  if (scenario === 'unknown retry') jest.mocked(deliveryById).mockRejectedValue(new Error('重试结果待核验'))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '发布详情' && typeof node.props.onPress === 'function')[0].props.onPress())
  const text = JSON.stringify(view.toJSON())
  if (scenario === 'confirmed') expect(text).toContain('原生表格、代码块、行内样式已确认写入。')
  else { expect(text).toContain('正文格式尚未核验。'); expect(text).not.toContain('已确认写入') }
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(retryDelivery).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})


test('plugin preflight failure remains the same editable draft with no POST or unknown freeze', async () => {
  jest.mocked(feishuApi).mockImplementation(async path => path === '/status' ? { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, expired: false, notify_self: false, groups: [] } : { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_attempt_create: true, can_create: true })
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
  const original = await readPublishDraft('owner', 'key')
  jest.mocked(assertFeishuPublishReady).mockRejectedValueOnce(Object.assign(new Error('请先在插件中安装并启用飞书，再发布文档'), { dispatchState: 'not_dispatched' }))
  await act(async () => button('创建飞书文档并通知').props.onPress())
  expect(assertFeishuPublishReady).toHaveBeenCalledWith('owner', expect.any(Number))
  expect(await readPublishDraft('owner', 'key')).toEqual(original)
  expect((await readPublishDraft('owner', 'key'))?.state).toBe('draft')
  expect(publishToFeishu).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).not.toContain('提交结果待核验')
  await act(async () => view.unmount())
})


test('changing destination revokes approval before the automatic read and after failure', async () => {
  let fail!: (reason: Error) => void
  const result = { name: '个人云文档', path: ['个人云文档'], path_complete: true, can_attempt_create: true, can_create: true }
  jest.mocked(feishuApi).mockImplementation(async path => path === '/status' ? { publish_receipt_protocol: 1, recipient_access_protocol: 1, configured: true, connected: true, expired: false, notify_self: false, groups: [] } : result)
  jest.mocked(deliveryStatus).mockResolvedValue(null)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => (title === '创建飞书文档并通知' ? ['创建文档', '创建并通知'].includes(node.props.title) : node.props.title === title))!
  expect(button('创建飞书文档并通知').props.disabled).toBe(false)
  jest.mocked(feishuApi).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '更改位置' && typeof node.props.onPress === 'function')[0].props.onPress())
  const picker = view.root.findByType(FeishuDestinationPicker)
  await act(async () => picker.props.onChange({ kind: 'folder', folder_token: 'changed' }))
  expect(button('创建飞书文档并通知').props.disabled).toBe(true)
  await act(async () => button('创建飞书文档并通知').props.onPress())
  expect(publishToFeishu).not.toHaveBeenCalled()
  await act(async () => fail(new Error('位置核验失败')))
  expect(button('创建飞书文档并通知').props.disabled).toBe(true)
  await act(async () => view.unmount())
})


test('unknown original operation still uses exact GET while grants are unavailable', async () => {
  const original = { ...newPublishDraft('owner', 'key', { title: '原冻结标题', content: '原正文' }, { notify_self: false, groups: [] }), state: 'unknown' as const };
  await persistPublishDraft(original);
  jest.mocked(feishuApi).mockResolvedValue({ configured: true, connected: false, expired: false, name: '测试', notify_self: false, groups: [], auto_publish: false, publish_receipt_protocol: 1, recipient_access_protocol: 1, connection_state: 'service_unavailable', grant_state: 'unavailable' });
  jest.mocked(deliveryByOperation).mockRejectedValue(new Error('原操作未查到'));
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<FeishuDeliveryPanel note={note} />) });
  expect(deliveryByOperation).toHaveBeenCalledWith(original.operationId, 'owner');
  expect(deliveryStatus).not.toHaveBeenCalled();
  expect(publishToFeishu).not.toHaveBeenCalled();
  expect(await readPublishDraft('owner', 'key')).toMatchObject({ state: 'unknown', operationId: original.operationId, snapshot: { content: '原正文' } });
  await act(async () => view.unmount());
});
