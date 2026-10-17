import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { integrationJson, verifyContentService } from '../src/lib/integration'
import { readAccountId } from '../src/lib/storage'
import { inspectIntake, intakeUrl, leaveReservedIntake, readIntake, recoverIntake, submitIntake, writeIntake } from '../src/lib/noteIntake'
import { launchClientNote, readClientNote } from '../src/lib/clientNotePipeline'
import { saveSourceNote } from '../src/lib/notes'
import { loadModels, loadSelection } from '../src/lib/models'
import { chatCompletion } from '../src/lib/chatCompletion'
import { transcribe } from '../src/lib/meetingCloud'
import { listLocalFileAssociations } from '../src/lib/localFileAssociations'
import { ApiError } from '../src/lib/errors'

jest.mock('../src/config/env', () => ({ API_BASE_URL: 'http://192.168.1.143:9876' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://extract.example', verifyContentService: jest.fn(), integrationJson: jest.fn(), operationId: () => '11111111-1111-4111-8111-111111111111' }))
jest.mock('../src/lib/notes', () => ({ saveSourceNote: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(), loadModels: jest.fn() }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn(async () => '完整转写') }))
jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn() }))
const api = jest.mocked(integrationJson)
const taskId = '12345678-1234-4234-8234-123456789012', operation = '11111111-1111-4111-8111-111111111111'
const extracted = { extraction_protocol: 1, title: '来源', text: '全部正文', source_sha256: 'a'.repeat(64), source_type: 'webpage' }
const url = { mode: 'url' as const, url: 'https://article.example/story' }
const file = { id: taskId, extension: 'm4a', uri: `file:///documents/files/accounts/owner/${taskId}.m4a`, name: '音轨.m4a', category: 'audio' as const, size: 100, createdAt: '2026-10-17' }
beforeEach(async () => {
  jest.clearAllMocks()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.mocked(readAccountId).mockResolvedValue('owner')
  jest.mocked(loadSelection).mockResolvedValue({ asr_model: 'selected-asr', llm_model: 'selected-llm' })
  jest.mocked(loadModels).mockResolvedValue([{ id: 'selected-asr', modelType: 'asr', runtimeStatus: 'available' }, { id: 'selected-llm', modelType: 'llm', runtimeStatus: 'available' }])
  jest.mocked(verifyContentService).mockResolvedValue({ text_extraction_protocol: 1, max_upload_bytes: 134217728 } as never)
  api.mockResolvedValue(extracted)
  jest.mocked(chatCompletion).mockResolvedValue({ choices: [{ message: { content: '# 正文' }, finish_reason: 'stop' }] } as never)
  jest.mocked(FS.stat).mockResolvedValue({ size: 100 } as never)
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(file))
  Object.assign(FS, { hash: jest.fn(async () => 'b'.repeat(64)) })
  jest.mocked(saveSourceNote).mockImplementation(async task => {
    const note = { id: `source-${task}`, content: '# 正文' }
    await Storage.setItem(`vinote:owner:note:${note.id}`, JSON.stringify(note))
    return note as never
  })
})
test('extracts a URL from share text without credentials', () => {
  expect(intakeUrl('分享 https://b23.tv/example')).toBe('https://b23.tv/example')
  expect(() => intakeUrl('https://a:b@article.example')).toThrow()
})
test('new URL uses extraction only and freezes origin before the first model call', async () => {
  const receipt = await submitIntake('owner', url)
  await launchClientNote('owner', receipt)
  expect(receipt).toMatchObject({ execution: 'client', modelOrigin: 'http://192.168.1.143:9876', modelSelection: { llm_model: 'selected-llm' } })
  expect(api.mock.calls.map(c => c[0])).toEqual(['/api/content-service/extract-url'])
  expect(api.mock.calls[0][1]?.body).toBe(JSON.stringify({ url: url.url }))
  expect(transcribe).not.toHaveBeenCalled()
  const record = await readClientNote('owner', receipt)
  expect(record.result?.markdown).toBe('# 正文')
  expect(record.extractedHash).toBe('a'.repeat(64))
})
test('media is retained, transcribed directly and linked to the saved source note', async () => {
  const receipt = await submitIntake('owner', { mode: 'file', url: '', file })
  await launchClientNote('owner', receipt)
  expect(api).not.toHaveBeenCalled()
  expect(transcribe).toHaveBeenCalledWith(file.uri, 'selected-asr', expect.objectContaining({ owner: 'owner' }))
  const result = await inspectIntake('owner', receipt)
  expect(result.note?.id).toBe(`source-${receipt.taskId}`)
  expect(await listLocalFileAssociations('owner', file.id)).toEqual([expect.objectContaining({ execution: 'client', modelOrigin: receipt.modelOrigin, noteId: result.note?.id, state: 'saved' })])
  expect(FS.unlink).not.toHaveBeenCalled()
})
test('save failure preserves completed result and reopening never regenerates', async () => {
  const receipt = await submitIntake('owner', url); await launchClientNote('owner', receipt)
  jest.mocked(saveSourceNote).mockRejectedValueOnce(new Error('磁盘已满'))
  await expect(inspectIntake('owner', receipt)).rejects.toThrow('磁盘已满')
  expect((await readIntake('owner')).operationId).toBe(receipt.operationId)
  expect((await inspectIntake('owner', receipt)).note).toBeDefined()
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  expect(api.mock.calls.some(c => c[0].startsWith('/api/task/'))).toBe(false)
})
test('result saving cannot clear a newer input slot', async () => {
  const receipt = await submitIntake('owner', url); await launchClientNote('owner', receipt)
  await writeIntake('owner', { mode: 'url', url: 'https://new.example' })
  await inspectIntake('owner', receipt)
  expect((await readIntake('owner')).url).toBe('https://new.example')
})
test('storage failure before operation acceptance dispatches no inference', async () => {
  jest.mocked(Storage.setItem).mockRejectedValueOnce(new Error('storage'))
  await expect(submitIntake('owner', url)).rejects.toThrow('storage')
  expect(api).not.toHaveBeenCalled(); expect(chatCompletion).not.toHaveBeenCalled()
})
test('a selected unavailable model is not replaced and creates no operation', async () => {
  jest.mocked(loadModels).mockResolvedValueOnce([])
  await expect(submitIntake('owner', url)).rejects.toThrow('所选模型暂不可用')
  expect((await readIntake('owner')).operationId).toBeUndefined()
  expect(chatCompletion).not.toHaveBeenCalled()
})
test('video URLs cannot silently fall back to cloud inference', async () => {
  await expect(submitIntake('owner', { mode: 'url', url: 'https://b23.tv/example' })).rejects.toThrow('设备保存音频')
  expect(api).not.toHaveBeenCalled()
})
test('changed model Origin rejects an existing client operation without cloud lookup', async () => {
  const receipt = await submitIntake('owner', url); await launchClientNote('owner', receipt)
  await expect(recoverIntake('owner', { ...receipt, modelOrigin: 'https://other.example' })).rejects.toThrow('来源')
  expect(api.mock.calls.some(c => c[0].startsWith('/api/task/'))).toBe(false)
})
test('foreign account cannot submit, read or save a device operation', async () => {
  jest.mocked(readAccountId).mockResolvedValueOnce('other')
  await expect(submitIntake('owner', url)).rejects.toThrow('账号')
  expect(chatCompletion).not.toHaveBeenCalled()
})
test('old accepted task is GET-only and never enters device ASR', async () => {
  const old = { ...url, taskId, operationId: operation, generationOrigin: 'https://extract.example', receiptState: 'accepted' as const }
  await writeIntake('owner', old)
  expect(await submitIntake('owner', old)).toEqual(old)
  api.mockResolvedValueOnce({ status: 'failed', retryable: true })
  expect((await inspectIntake('owner', old)).status.retryable).toBe(false)
  expect(api).toHaveBeenCalledWith(`/api/task/${taskId}`, {}, 'owner')
  expect(transcribe).not.toHaveBeenCalled(); expect(chatCompletion).not.toHaveBeenCalled()
})
test('old uncertain operation recovers by exact receipt GET, no resubmit', async () => {
  const old = { ...url, operationId: operation, generationOrigin: 'https://extract.example', uncertain: true }
  await writeIntake('owner', old)
  api.mockResolvedValueOnce({ operation_id: operation, task_id: taskId, state: 'accepted' })
  const receipt = await submitIntake('owner', { ...url, url: 'https://changed.example' })
  expect(receipt.taskId).toBe(taskId)
  expect(api.mock.calls.map(c => c[0])).toEqual([`/api/source-requests/${operation}`])
  expect(loadModels).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled()
})
test('old missing receipt stays protected and cannot authorize another POST', async () => {
  const old = { ...url, operationId: operation, uncertain: true }
  await writeIntake('owner', old)
  api.mockRejectedValueOnce(new ApiError('missing', 404))
  await expect(recoverIntake('owner', old)).rejects.toThrow('原提交回执')
  expect((await readIntake('owner')).operationId).toBe(operation)
  expect(chatCompletion).not.toHaveBeenCalled()
})
test('reserved old receipt remains archived on explicit source change', async () => {
  const old = { ...url, operationId: operation, taskId, receiptState: 'reserved' as const }
  await writeIntake('owner', old); await leaveReservedIntake('owner', old)
  expect((await readIntake('owner')).operationId).toBeUndefined()
  expect(await Storage.getItem(`vinote:owner:source-request:${operation}`)).not.toBeNull()
  expect(api).not.toHaveBeenCalled()
})

test.each(['txt', 'srt', 'vtt', 'json', 'pdf', 'docx'])('plain extraction of %s carries no model fields and runs no ASR', async extension => {
  const source = { ...file, extension, name: `原件.${extension}`, uri: `file:///documents/files/accounts/owner/${taskId}.${extension}`, category: 'file' as const }
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(source))
  api.mockResolvedValueOnce({ ...extracted, source_type: ['pdf', 'docx'].includes(extension) ? 'document' : 'transcript' })
  const receipt = await submitIntake('owner', { mode: 'file', url: '', file: source })
  await launchClientNote('owner', receipt)
  const [path, init] = api.mock.calls[0]
  expect(path).toBe('/api/content-service/extract-file')
  expect(Array.from((init?.body as unknown as { keys(): IterableIterator<string> }).keys())).toEqual(['file'])
  expect(transcribe).not.toHaveBeenCalled()
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  expect((await readClientNote('owner', receipt)).source.sha256).toBe('b'.repeat(64))
})

test('receipt persistence failure can explicitly finish the same pre-dispatch operation, never a second one', async () => {
  const original = jest.mocked(Storage.setItem).getMockImplementation()!
  let fail = true
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    if (fail && key.includes(':source-request:')) { fail = false; throw new Error('receipt storage') }
    return original(key, value)
  })
  try {
    await expect(submitIntake('owner', url)).rejects.toThrow('receipt storage')
    expect(chatCompletion).not.toHaveBeenCalled()
    const receipt = await submitIntake('owner', url)
    await launchClientNote('owner', receipt)
    expect((await Storage.getAllKeys()).filter(key => key.includes(':client-note:'))).toHaveLength(1)
    expect(chatCompletion).toHaveBeenCalledTimes(1)
  } finally { jest.mocked(Storage.setItem).mockImplementation(original) }
})
