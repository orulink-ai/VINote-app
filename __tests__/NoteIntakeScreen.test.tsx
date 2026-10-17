import { Text } from '../src/components/AppText'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { NoteIntakeScreen } from '../src/screens/NoteIntakeScreen'
import { inspectIntake, readIntake, recoverIntake, submitIntake, writeIntake } from '../src/lib/noteIntake'
import { verifyLocalFile, type LocalFile } from '../src/lib/localFiles'
import { integrationJson } from '../src/lib/integration'
import { readAccountId } from '../src/lib/storage'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/localFiles', () => ({ importLocalFile: jest.fn(), verifyLocalFile: jest.fn(async () => {}) }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://source.invalid', verifyContentService: jest.fn(async () => ({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true })), integrationJson: jest.fn() }))
jest.mock('../src/lib/noteIntake', () => ({ assertIntakeOrigin: jest.fn(), readIntake: jest.fn(), recoverIntake: jest.fn(), submitIntake: jest.fn(), inspectIntake: jest.fn(), writeIntake: jest.fn(async () => {}), intakeFileName: jest.fn(), intakeSourceType: jest.fn() }))
const pending = { mode: 'url' as const, url: 'https://python.org/about', operationId: 'original', receiptState: 'unknown' as const, uncertain: true }
const accepted = { ...pending, generationOrigin: 'https://source.invalid', taskId: 'original-task', receiptState: 'accepted' as const, uncertain: false }
test('a changed history target preserves the newer source without querying or dispatching it', async () => {
  jest.mocked(readIntake).mockResolvedValue({ ...pending, generationOrigin: 'https://source.invalid', operationId: 'newer-operation' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen recoveryTarget={{ owner: 'owner', generationOrigin: 'https://source.invalid', operationId: 'original' }} onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(recoverIntake).not.toHaveBeenCalled()
  expect(inspectIntake).not.toHaveBeenCalled()
  expect(writeIntake).not.toHaveBeenCalled()
  expect(submitIntake).not.toHaveBeenCalled()
  expect(view.root.findAll(node => node.props.accessibilityRole === 'alert' && String(node.props.children).includes('原来源任务或账号已变化')).length).toBeGreaterThan(0)
  await act(async () => view.unmount())
})
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(inspectIntake).mockReset()
  jest.mocked(integrationJson).mockReset()
  jest.mocked(readAccountId).mockResolvedValue('owner')
  jest.mocked(readIntake).mockReset().mockResolvedValue(pending)
  jest.mocked(writeIntake).mockReset().mockImplementation(async (_owner, value) => { jest.mocked(readIntake).mockResolvedValue(value) })
  jest.mocked(recoverIntake).mockResolvedValue(accepted)
})
function press(view: Renderer.ReactTestRenderer, title: string) {
  return view.root.findAll(node => node.props.title === title && typeof node.props.onPress === 'function')[0].props.onPress()
}
test('unknown reentry reads its original operation; reserved never submits or retries', async () => {
  jest.mocked(recoverIntake).mockResolvedValue({ ...accepted, uncertain: true, receiptState: 'reserved' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(recoverIntake).toHaveBeenCalledWith('owner', pending)
  expect(inspectIntake).not.toHaveBeenCalled()
  await act(async () => { await press(view, '核验原提交') })
  expect(recoverIntake).toHaveBeenCalledTimes(2)
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
  expect(view.root.findAll(node => node.props.title === '更换来源')).toHaveLength(0)
  await act(async () => view.unmount())
})
test('accepted failed work is explicitly retried by the same task after a fresh read', async () => {
  jest.mocked(readIntake).mockResolvedValue(accepted)
  jest.mocked(inspectIntake).mockResolvedValue({ status: { status: 'failed', retryable: true, message: 'provider failed' } })
  jest.mocked(integrationJson).mockResolvedValue({ task_id: 'original-task', status: 'preparing' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => { await press(view, '重试处理原任务') })
  expect(inspectIntake).toHaveBeenCalledTimes(2)
  expect(integrationJson).toHaveBeenCalledWith('/api/task/original-task/retry', { method: 'POST' }, 'owner', 45000, expect.any(Function))
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
test('a task already running at retry readback is only queried and is not dispatched again', async () => {
  jest.mocked(readIntake).mockResolvedValue(accepted)
  jest.mocked(inspectIntake).mockResolvedValueOnce({ status: { status: 'failed', retryable: true } }).mockResolvedValueOnce({ status: { status: 'summarizing', message: 'already running' } })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  await act(async () => { await press(view, '重试处理原任务') })
  expect(integrationJson).not.toHaveBeenCalled()
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
const libraryFile: LocalFile = { id: 'current-file', name: 'document.pdf', uri: 'file:///current-file.pdf', size: 100, category: 'file', extension: 'pdf', createdAt: '2026-10-12' }
test('a selected library file is verified and prepared without opening a picker or submitting', async () => {
  jest.mocked(readIntake).mockResolvedValue({ mode: 'url', url: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen initialFile={libraryFile} initialMode="file" onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(verifyLocalFile).toHaveBeenCalledWith(libraryFile)
  expect(writeIntake).toHaveBeenCalledWith('owner', { mode: 'file', url: '', file: libraryFile })
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
test('a previous completed task does not hijack the selected library file flow', async () => {
  jest.mocked(inspectIntake).mockResolvedValue({ note: { id: 'previous-note' }, status: { status: 'completed' } } as never)
  const onSaved = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen initialFile={libraryFile} initialMode="file" onBack={jest.fn()} onSaved={onSaved} />) })
  expect(writeIntake).not.toHaveBeenCalled()
  expect(submitIntake).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  expect(view.root.findAll(node => node.props.title === '查看原任务生成的笔记').length).toBeGreaterThan(0)
  await act(async () => view.unmount())
})

test('failed source preparation can retry without submitting or replacing the original receipt', async () => {
  jest.mocked(readIntake).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ mode: 'url', url: '' })
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen initialFile={libraryFile} initialMode="file" onBack={back} onSaved={jest.fn()} />) })
  expect(view.root.findAll(node => node.props.title === '重新读取来源').length).toBeGreaterThan(0)
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => { await press(view, '重新读取来源') })
  expect(writeIntake).toHaveBeenCalledWith('owner', { mode: 'file', url: '', file: libraryFile })
  expect(submitIntake).not.toHaveBeenCalled()
  expect(view.root.findAll(node => node.props.title === '重新读取来源')).toHaveLength(0)
  await act(async () => view.unmount())
})

test('production shows source and processing state and retries only the exact unknown original', async () => {
  const previous = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false
  let view!: Renderer.ReactTestRenderer
  try {
    jest.mocked(readIntake).mockReset().mockResolvedValue(pending)
  jest.mocked(writeIntake).mockReset().mockImplementation(async (_owner, value) => { jest.mocked(readIntake).mockResolvedValue(value) })
    jest.mocked(recoverIntake).mockRejectedValue(new Error('当前服务不支持去重，原提交回执待核验'))
    await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
    const text = view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
    expect(text).toContain('保存位置：笔记')
    expect(text).not.toMatch(/回执|去重|编号|开发诊断/)
    expect(view.root.findAll(node => node.props.value === pending.url).length).toBeGreaterThan(0)
    await act(async () => { await press(view, '核验原提交') })
    expect(recoverIntake).toHaveBeenLastCalledWith('owner', expect.objectContaining({ operationId: 'original', url: pending.url }))
    expect(submitIntake).not.toHaveBeenCalled()
  } finally { if (view) await act(async () => view.unmount()); (globalThis as unknown as { __DEV__: boolean }).__DEV__ = previous }
})

test('content service readiness is GET-only and retry never submits generation', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  jest.mocked(readIntake).mockResolvedValue({ mode: 'url', url: 'https://python.org/about' })
  verifyContentService.mockRejectedValueOnce({ code: 'CONTENT_SERVICE_DISABLED', status: 503 }).mockResolvedValue({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')).toContain('服务尚未启用')
  expect(view.root.findAll(node => node.props.title === '生成总结笔记')[0].props.disabled).toBe(true)
  expect(submitIntake).not.toHaveBeenCalled()
  await act(async () => { await press(view, '重新检查服务') })
  expect(verifyContentService).toHaveBeenCalledTimes(2)
  expect(view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')).toContain('内容服务已就绪')
  expect(view.root.findAll(node => node.props.title === '生成总结笔记')[0].props.disabled).toBe(false)
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('a late readiness check cannot update an unmounted import page or submit work', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  let finish!: () => void
  verifyContentService.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  jest.mocked(readIntake).mockResolvedValue({ mode: 'url', url: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  await act(async () => view.unmount())
  await act(async () => finish())
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
})

test.each([
  [{ mode: 'url', url: 'https://b23.tv/synthetic' }, '导入文件'],
  [{ mode: 'file', url: '', file: { ...libraryFile, extension: 'mp4', size: 134217729 } }, '128 MB'],
  [{ mode: 'file', url: '', file: { ...libraryFile, size: 20971521 } }, '20 MB'],
])('capabilities block unsupported links or oversized files without generation: %j', async (draft, copy) => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: false })
  jest.mocked(readIntake).mockResolvedValue(draft as never)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen initialMode={draft.mode as 'url' | 'file'} onBack={jest.fn()} onSaved={jest.fn()} />) })
  expect(view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')).toContain(copy)
  expect(view.root.findAll(node => node.props.title === '生成总结笔记')[0].props.disabled).toBe(true)
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test.each([['https://b23.tv/synthetic', false], ['https://youtu.be/synthetic', true]])('Bilibili-only readiness restores a scoped link entry without auto generation: %s', async (url, blocked) => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true, video_url_platforms: ['bilibili'] })
  jest.mocked(readIntake).mockResolvedValue({ mode: 'url', url })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  const text = view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
  expect(text).toContain('网页、B站或文档链接')
  expect(text).toContain('b23.tv')
  expect(text).toContain('其他视频或音频请导入文件')
  if (blocked) expect(text).toContain('目前仅支持 B 站')
  expect(view.root.findAll(node => node.props.title === '生成总结笔记')[0].props.disabled).toBe(blocked)
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('master video switch false hides Bilibili entry and blocks generation despite platform list', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: false, video_url_platforms: ['bilibili'] })
  jest.mocked(readIntake).mockResolvedValue({ mode: 'url', url: 'https://b23.tv/synthetic' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) })
  const text = view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
  expect(text).not.toContain('网页、B站或文档链接')
  expect(text).toContain('暂不支持视频或音频链接')
  expect(view.root.findAll(node => node.props.title === '生成总结笔记')[0].props.disabled).toBe(true)
  expect(submitIntake).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
