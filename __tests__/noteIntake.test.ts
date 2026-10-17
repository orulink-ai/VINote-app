import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { integrationJson } from '../src/lib/integration'
import { readAccountId } from '../src/lib/storage'
import { inspectIntake, intakeUrl, readIntake, recoverIntake, submitIntake } from '../src/lib/noteIntake'
import { ApiError } from '../src/lib/errors'
import { saveSourceNote } from '../src/lib/notes'
import { listLocalFileAssociations } from '../src/lib/localFileAssociations'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'http://127.0.0.1:8900', verifyContentService: jest.fn(async () => ({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true })), integrationJson: jest.fn(), operationId: () => '11111111-1111-4111-8111-111111111111' }))
jest.mock('../src/lib/notes', () => ({ saveSourceNote: jest.fn() }))
const api = integrationJson as jest.Mock
const taskId = '12345678-1234-4234-8234-123456789012'
const operation = '11111111-1111-4111-8111-111111111111'
beforeEach(async () => { jest.clearAllMocks(); (readAccountId as jest.Mock).mockResolvedValue('owner'); for (const key of await Storage.getAllKeys()) await Storage.removeItem(key) })

it('extracts the video URL from Bilibili share text', () => {
  expect(intakeUrl('【示例视频】 https://b23.tv/example 分享给你')).toBe('https://b23.tv/example')
  expect(() => intakeUrl('不是链接')).toThrow()
})
it('persists the accepted task and resumes it without submitting again', async () => {
  api.mockResolvedValueOnce({ task_id: taskId })
  const receipt = await submitIntake('owner', { mode: 'url', url: 'https://b23.tv/example' })
  expect((await readIntake('owner')).taskId).toBe(taskId)
  expect(await submitIntake('owner', receipt)).toEqual(receipt)
  expect(api).toHaveBeenCalledTimes(1)
})
it('keeps an uncertain submission after a lost response', async () => {
  api.mockRejectedValueOnce(new Error('连接中断'))
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/example' })).rejects.toThrow('连接中断')
  expect((await readIntake('owner')).uncertain).toBe(true)
  expect(api).toHaveBeenCalledTimes(1)
})
it('retains the receipt after local saving fails and queries the same task on retry', async () => {
  const receipt = { mode: 'url' as const, url: 'https://b23.tv/example', taskId }
  await Storage.setItem('vinote:owner:note-intake', JSON.stringify(receipt))
  api.mockResolvedValue({ status: 'success', result: { title: '示例', markdown: '# 总结' } })
  ;(saveSourceNote as jest.Mock).mockRejectedValueOnce(new Error('本地存储不足')).mockResolvedValueOnce({ id: 'saved-note' })
  await expect(inspectIntake('owner', receipt)).rejects.toThrow('本地存储不足')
  expect((await readIntake('owner')).taskId).toBe(taskId)
  expect((await inspectIntake('owner', receipt)).note?.id).toBe('saved-note')
  expect((await readIntake('owner')).taskId).toBeUndefined()
  expect(api).toHaveBeenLastCalledWith(`/api/task/${taskId}`, {}, 'owner')
})
it('does not submit content after switching accounts', async () => {
  ;(readAccountId as jest.Mock).mockResolvedValue('different-owner')
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/example' })).rejects.toThrow('账号已切换')
  expect(api).not.toHaveBeenCalled()
})
it('protects the operation and source before dispatch, and sends the original header', async () => {
  api.mockImplementationOnce(async (_path, init) => {
    const persisted = await readIntake('owner')
    expect(persisted).toMatchObject({ operationId: operation, url: 'https://python.org/about', uncertain: true })
    expect(init.headers['X-VINote-Operation-Id']).toBe(operation)
    return { task_id: taskId, operation_id: operation, state: 'accepted', source_type: 'file' }
  })
  const value = await submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })
  expect(value).toMatchObject({ taskId, operationId: operation, receiptState: 'accepted', sourceType: 'file' })
})
it('recovers a lost response by GET only, even from a stale draft with changed input', async () => {
  api.mockRejectedValueOnce(new Error('response lost'))
  await expect(submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })).rejects.toThrow('response lost')
  api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted', source_type: 'file' })
  const recovered = await submitIntake('owner', { mode: 'url', url: 'https://example.invalid/different-input' })
  expect(recovered.url).toBe('https://python.org/about')
  expect(recovered.taskId).toBe(taskId)
  expect(api).toHaveBeenLastCalledWith(`/api/source-requests/${operation}`, {}, 'owner')
  expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})
it('reserved receipts are durable but never dispatch or retry a task', async () => {
  api.mockResolvedValue({ task_id: taskId, operation_id: operation, state: 'reserved' })
  const pending = await submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })
  expect(pending.receiptState).toBe('reserved')
  await expect(inspectIntake('owner', pending)).rejects.toThrow('尚未确认排队')
  expect((await recoverIntake('owner', pending)).receiptState).toBe('reserved')
  expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  expect(api.mock.calls.some(([path]) => path.endsWith('/retry'))).toBe(false)
})
it('404 and validation errors preserve the same operation without authorizing another POST', async () => {
  api.mockRejectedValueOnce(new ApiError('validation', 422))
  await expect(submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })).rejects.toThrow('validation')
  const pending = await readIntake('owner')
  api.mockRejectedValueOnce(new ApiError('not found', 404))
  await expect(recoverIntake('owner', pending)).rejects.toThrow('尚未查到原提交回执')
  expect((await readIntake('owner')).operationId).toBe(operation)
  expect(api.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
})
it('a persistence failure dispatches nothing', async () => {
  jest.mocked(Storage.setItem).mockRejectedValueOnce(new Error('disk full'))
  await expect(submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })).rejects.toThrow('disk full')
  expect(api).not.toHaveBeenCalled()
})
it('DOCX uploads send the same protected operation and retain the local original', async () => {
  jest.mocked(FS.stat).mockResolvedValue({ size: 100 } as never)
  api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted', source_type: 'file' })
  const file = { id: taskId, extension: 'docx', uri: `file:///documents/files/accounts/owner/${taskId}.docx`, name: '正文.docx', category: 'file' as const, size: 100, createdAt: '2026-10-12' }
  jest.mocked(FS.readFile).mockResolvedValueOnce(JSON.stringify(file))
  await submitIntake('owner', { mode: 'file', url: '', file })
  expect(api).toHaveBeenCalledWith('/api/generate_from_upload', expect.objectContaining({ headers: { 'X-VINote-Operation-Id': operation } }), 'owner', 180000)
  expect((await readIntake('owner')).file).toEqual(file)
  expect(FS.unlink).not.toHaveBeenCalled()
})

it('original task success persists the actual file-to-note association before clearing its intake', async () => {
  jest.mocked(FS.stat).mockResolvedValue({ size: 100 } as never)
  const file = { id: taskId, extension: 'pdf', uri: `file:///documents/files/accounts/owner/${taskId}.pdf`, name: 'source.pdf', category: 'file' as const, size: 100, createdAt: '2026-10-12' }
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(file))
  api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted', source_type: 'file' })
  const receipt = await submitIntake('owner', { mode: 'file', url: '', file })
  api.mockResolvedValueOnce({ status: 'success', result: { title: '真实结果', markdown: '# Result' } })
  jest.mocked(saveSourceNote).mockImplementationOnce(async () => {
    const note = { id: `source-${taskId}`, content: '# Result' }
    await Storage.setItem(`vinote:owner:note:${note.id}`, JSON.stringify(note))
    return note as never
  })
  const result = await inspectIntake('owner', receipt)
  expect(result.note?.id).toBe(`source-${taskId}`)
  expect((await listLocalFileAssociations('owner', file.id))[0]).toMatchObject({ taskId, noteId: `source-${taskId}`, state: 'saved', generationOrigin: 'http://127.0.0.1:8900' })
  expect((await readIntake('owner')).operationId).toBeUndefined()
  expect(FS.unlink).not.toHaveBeenCalled()
})

it('a changed processing origin prevents GET recovery and result reads without rebinding or replay', async () => {
  const receipt = { mode: 'file' as const, url: '', taskId, operationId: operation, generationOrigin: 'https://previous.example', receiptState: 'accepted' as const }
  await expect(recoverIntake('owner', receipt)).rejects.toThrow('跨服务')
  await expect(inspectIntake('owner', receipt)).rejects.toThrow('跨服务')
  expect(api).not.toHaveBeenCalled()
})
it('double submission shares one protected operation and one request', async () => {
  api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted' })
  const draft = { mode: 'url' as const, url: 'https://python.org/about' }
  const [first, second] = await Promise.all([submitIntake('owner', draft), submitIntake('owner', draft)])
  expect(second).toEqual(first)
  expect(api).toHaveBeenCalledTimes(1)
})

test.each([['mp4', 134217729, '128 MB'], ['pdf', 20971521, '20 MB'], ['docx', 20971521, '20 MB']])('rejects %s above the advertised upload budget before POST or unknown receipt', async (extension, size, copy) => {
  jest.mocked(FS.stat).mockResolvedValue({ size } as never)
  const file = { id: taskId, extension, uri: `file:///documents/files/accounts/owner/${taskId}.${extension}`, name: `source.${extension}`, category: 'file' as const, size, createdAt: '2026-10-17' }
  await expect(submitIntake('owner', { mode: 'file', url: '', file })).rejects.toThrow(copy)
  expect(api).not.toHaveBeenCalled()
  expect((await readIntake('owner')).operationId).toBeUndefined()
})

test('failed service preflight never persists an unknown submission or POSTs', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockRejectedValueOnce(new Error('service unavailable'))
  await expect(submitIntake('owner', { mode: 'url', url: 'https://python.org/about' })).rejects.toThrow('service unavailable')
  expect(api).not.toHaveBeenCalled()
  expect((await readIntake('owner')).operationId).toBeUndefined()
})

test.each(['https://b23.tv/synthetic', 'https://www.bilibili.com/video/synthetic', 'https://youtu.be/synthetic', 'https://media.example/demo.mp4'])('disabled video URL capability rejects %s before source POST', async url => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: false, video_url_reason: 'DOWNLOAD_EGRESS_NOT_ENFORCED' })
  await expect(submitIntake('owner', { mode: 'url', url })).rejects.toThrow('导入文件')
  expect(api).not.toHaveBeenCalled()
  expect((await readIntake('owner')).operationId).toBeUndefined()
})

test.each([
  ['https://b23.tv/synthetic', true],
  ['https://youtu.be/synthetic', false],
  ['https://media.example/synthetic.mp4', false],
])('intake respects Bilibili-only scope before persisting new requests: %s', async (url, allowed) => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true, video_url_platforms: ['bilibili'] })
  if (allowed) {
    api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted' })
    await expect(submitIntake('owner', { mode: 'url', url })).resolves.toMatchObject({ taskId })
    expect(api).toHaveBeenCalledWith('/api/generate', expect.anything(), 'owner', 180000)
  } else {
    await expect(submitIntake('owner', { mode: 'url', url })).rejects.toThrow('仅支持 B 站')
    expect(api).not.toHaveBeenCalled()
    expect((await readIntake('owner')).operationId).toBeUndefined()
  }
})

test('master video switch false blocks Bilibili at source submission before any unknown marker or POST', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: false, video_url_platforms: ['bilibili'] })
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/synthetic' })).rejects.toThrow('暂不支持')
  expect(api).not.toHaveBeenCalled()
  expect((await readIntake('owner')).operationId).toBeUndefined()
})

test.each([422, 502])('Bilibili source preflight rejection %s preserves real error without pending operation or generation POST', async status => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true, video_url_platforms: ['bilibili'], video_source_preflight: 1 })
  const error = new ApiError('B站来源受限（HTTP 412），请稍后核验。', status)
  api.mockRejectedValueOnce(error)
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/synthetic' })).rejects.toBe(error)
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('/api/content-service/video-source', { method: 'POST', body: JSON.stringify({ url: 'https://b23.tv/synthetic' }) }, 'owner', 60000)
  expect((await readIntake('owner')).operationId).toBeUndefined()
  expect((await readIntake('owner')).uncertain).toBeUndefined()
  expect((await Storage.getAllKeys()).some(key => key.includes(':source-request:'))).toBe(false)
})

test('source preflight success precedes pending persistence and the single generation submission', async () => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true, video_url_platforms: ['bilibili'], video_source_preflight: 1 })
  api.mockImplementationOnce(async () => {
    expect((await readIntake('owner')).operationId).toBeUndefined()
    return { title: '示例', video_id: 'synthetic', duration: 73, url: 'https://b23.tv/synthetic' }
  }).mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted' })
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/synthetic' })).resolves.toMatchObject({ taskId })
  expect(api.mock.calls.map(call => call[0])).toEqual(['/api/content-service/video-source', '/api/generate'])
})

test.each([['https://b23.tv/synthetic', false], ['https://python.org/about', true]])('legacy device or ordinary webpage does not invoke video-source preflight: %s', async (url, enabled) => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  verifyContentService.mockResolvedValueOnce({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true, ...(enabled ? { video_source_preflight: 1 } : {}) })
  api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted' })
  await submitIntake('owner', { mode: 'url', url })
  expect(api.mock.calls.map(call => call[0])).toEqual(['/api/generate'])
})

test.each([false, true])('existing accepted/recoverable task skips all new-source preflight: recovery=%s', async recovery => {
  const { verifyContentService } = require('../src/lib/integration') as { verifyContentService: jest.Mock }
  const original = { mode: 'url', url: 'https://b23.tv/synthetic', ...(recovery ? { operationId: operation, uncertain: true } : { taskId, receiptState: 'accepted' }) }
  await Storage.setItem('vinote:owner:note-intake', JSON.stringify(original))
  if (recovery) api.mockResolvedValueOnce({ task_id: taskId, operation_id: operation, state: 'accepted', status: 'processing' })
  await submitIntake('owner', original as never)
  expect(verifyContentService).not.toHaveBeenCalled()
  expect(api.mock.calls.map(call => call[0])).toEqual(recovery ? [`/api/source-requests/${operation}`] : [])
})
