import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { prepareClientNote, recoverPreparedClientNote, launchClientNote, readClientNote, retryClientNote } from '../src/lib/clientNotePipeline'
import { readAccountId } from '../src/lib/storage'
import { integrationJson, verifyContentService } from '../src/lib/integration'
import { transcribe } from '../src/lib/meetingCloud'
import { chatCompletion } from '../src/lib/chatCompletion'
import { loadModels } from '../src/lib/models'
import { ApiError } from '../src/lib/errors'
import type { IntakeDraft } from '../src/lib/noteIntake'

jest.mock('../src/config/env', () => ({ API_BASE_URL: 'http://192.168.1.143:9876' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/sessionIdentity', () => ({ identityEpoch: () => 1 }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://content.example', operationId: jest.fn(() => '11111111-1111-4111-8111-111111111111'), verifyContentService: jest.fn(async () => ({ text_extraction_protocol: 1, max_upload_bytes: 10000 })), integrationJson: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ asr_model: 'same-asr', llm_model: 'same-llm' })), loadModels: jest.fn(async () => [{ id: 'same-asr', modelType: 'asr', runtimeStatus: 'available' }, { id: 'same-llm', modelType: 'llm', runtimeStatus: 'available' }]) }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn(async () => '完整转写') }))
jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn(async () => ({ choices: [{ message: { content: '# 笔记' }, finish_reason: 'stop' }] })) }))
const draft: IntakeDraft = { mode: 'url', url: 'https://article.example/a', sourceType: 'file' }
test('a historical video file cannot reserve a new model operation or run inference', async () => {
  await expect(prepareClientNote('alice', { mode: 'file', url: '', sourceType: 'video', file: { id: 'old', name: 'old.mp4', extension: 'mp4', uri: 'file:///documents/old.mp4' } as never })).rejects.toThrow('视频')
  expect(loadModels).not.toHaveBeenCalled()
  expect(transcribe).not.toHaveBeenCalled()
  expect(chatCompletion).not.toHaveBeenCalled()
  expect(await Storage.getAllKeys()).toEqual([])
})
const extracted = { extraction_protocol: 1, title: '文章', text: '完整来源', source_sha256: 'a'.repeat(64), source_type: 'webpage' }
beforeEach(async () => {
  jest.clearAllMocks()
  const service = require('../src/lib/integration') as { operationId: jest.Mock }
  service.operationId.mockReset().mockReturnValue('11111111-1111-4111-8111-111111111111')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(integrationJson).mockResolvedValue(extracted)
})
test('new operations freeze LAN origin and never send model IDs to extraction', async () => {
  const receipt = await prepareClientNote('alice', draft)
  expect(receipt.execution).toBe('client')
  expect((await readClientNote('alice', receipt)).modelOrigin).toBe('http://192.168.1.143:9876')
  await launchClientNote('alice', receipt)
  expect(integrationJson).toHaveBeenCalledWith('/api/content-service/extract-url', expect.objectContaining({ body: JSON.stringify({ url: draft.url }) }), 'alice', 60000)
  expect(transcribe).not.toHaveBeenCalled()
  expect(chatCompletion).toHaveBeenCalledWith('same-llm', expect.any(Array), 'alice')
  expect((await readClientNote('alice', receipt)).result?.markdown).toBe('# 笔记')
})

test('explicit task models survive changed global selection without writing defaults or calling inference', async () => {
  const models = { asr_model: 'same-asr', llm_model: 'explicit-llm' }
  jest.mocked(loadModels).mockResolvedValueOnce([
    { id: 'same-asr', modelType: 'asr', runtimeStatus: 'available' },
    { id: 'explicit-llm', modelType: 'llm', runtimeStatus: 'available' },
  ])
  const receipt = await prepareClientNote('alice', draft, models)
  expect(receipt.modelSelection).toEqual(models)
  expect(chatCompletion).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled()
  expect(Storage.setItem).not.toHaveBeenCalledWith('vinote:alice:models', expect.anything())
})

test('a pending source keeps its original models instead of silently replacing the confirmed pair', async () => {
  const receipt = await prepareClientNote('alice', draft)
  jest.mocked(loadModels).mockResolvedValueOnce([
    { id: 'other', modelType: 'llm', runtimeStatus: 'available' },
  ])
  await expect(prepareClientNote('alice', draft, { asr_model: 'same-asr', llm_model: 'other' })).rejects.toThrow('原准备操作模型不同')
  expect((await readClientNote('alice', receipt)).models.llm_model).toBe('same-llm')
  expect(chatCompletion).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled()
})
test('transport ambiguity is durable and explicit retry cannot replay', async () => {
  jest.mocked(chatCompletion).mockRejectedValueOnce(new Error('connection lost'))
  const receipt = await prepareClientNote('alice', draft)
  await launchClientNote('alice', receipt)
  expect((await readClientNote('alice', receipt)).status).toBe('unknown')
  await expect(retryClientNote('alice', receipt)).rejects.toThrow('未确认')
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})
test('file hash failure and account switch cannot dispatch inference', async () => {
  jest.mocked(readAccountId).mockResolvedValueOnce('bob')
  await expect(prepareClientNote('alice', draft)).rejects.toThrow()
  expect(chatCompletion).not.toHaveBeenCalled()
  expect(loadModels).not.toHaveBeenCalled()
})


test('missing extraction protocol fails before LLM and can continue without changing models', async () => {
  jest.mocked(verifyContentService).mockResolvedValueOnce({ max_upload_bytes: 10000 } as never)
  const receipt = await prepareClientNote('alice', draft)
  await launchClientNote('alice', receipt)
  expect((await readClientNote('alice', receipt)).status).toBe('failed')
  expect(chatCompletion).not.toHaveBeenCalled()
  await retryClientNote('alice', receipt)
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})
test('definite model rejection permits only explicit continuation with the frozen IDs and text', async () => {
  jest.mocked(chatCompletion).mockRejectedValueOnce(new ApiError('rate limited', 429))
  const receipt = await prepareClientNote('alice', draft)
  await launchClientNote('alice', receipt)
  expect((await readClientNote('alice', receipt)).retryable).toBe(true)
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  await retryClientNote('alice', receipt)
  expect(chatCompletion).toHaveBeenCalledTimes(2)
  expect(integrationJson).toHaveBeenCalledTimes(1)
  expect(jest.mocked(chatCompletion).mock.calls.map(c => c[0])).toEqual(['same-llm', 'same-llm'])
})
test('durable inFlight after process interruption stays unknown on read and cannot restart', async () => {
  const receipt = await prepareClientNote('alice', draft)
  const key = `vinote:alice:client-note:${receipt.operationId}`
  const record = JSON.parse((await Storage.getItem(key))!)
  await Storage.setItem(key, JSON.stringify({ ...record, status: 'running', inFlight: 'llm' }))
  expect((await readClientNote('alice', receipt)).status).toBe('unknown')
  await launchClientNote('alice', receipt)
  await expect(retryClientNote('alice', receipt)).rejects.toThrow('未确认')
  expect(chatCompletion).not.toHaveBeenCalled()
})
test('concurrent launch claims cannot dispatch a second inference', async () => {
  const receipt = await prepareClientNote('alice', draft)
  await Promise.all([launchClientNote('alice', receipt), launchClientNote('alice', receipt)])
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})
test('changing account during extraction cannot dispatch a model or write another owner record', async () => {
  const receipt = await prepareClientNote('alice', draft)
  jest.mocked(integrationJson).mockImplementationOnce(async () => {
    jest.mocked(readAccountId).mockResolvedValue('bob')
    return extracted as never
  })
  await launchClientNote('alice', receipt)
  expect(chatCompletion).not.toHaveBeenCalled()
  expect((await Storage.getAllKeys()).filter(k => k.startsWith('vinote:bob:'))).toEqual([])
})
test.each([undefined, '', 'not-a-hash'])('invalid extraction fingerprint %s blocks before inference', async source_sha256 => {
  jest.mocked(integrationJson).mockResolvedValueOnce({ ...extracted, source_sha256 } as never)
  const receipt = await prepareClientNote('alice', draft)
  await launchClientNote('alice', receipt)
  expect((await readClientNote('alice', receipt)).status).toBe('failed')
  expect(chatCompletion).not.toHaveBeenCalled()
})

const legacyAudio = { mode: 'file' as const, url: '', sourceType: 'audio', file: { id: '1729000000000-legacy', uri: 'file:///documents/recordings/accounts/alice/1729000000000-legacy.m4a', title: '原录音', duration: 12, createdAt: '2026-10-17' } }
function mockOriginal() {
  jest.mocked(FS.stat).mockResolvedValue({ size: 100 } as never)
  Object.assign(FS, { hash: jest.fn(async () => 'b'.repeat(64)) })
}
test('legacy safe recording IDs remain usable and media never calls shared extraction', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  await launchClientNote('alice', receipt)
  expect(transcribe).toHaveBeenCalledWith(legacyAudio.file.uri, 'same-asr', expect.any(Object))
  expect(integrationJson).not.toHaveBeenCalled(); expect(verifyContentService).not.toHaveBeenCalled()
})
test('media source hash is rechecked before the first ASR', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  jest.mocked(FS.hash).mockResolvedValueOnce('c'.repeat(64))
  await launchClientNote('alice', receipt)
  expect(transcribe).not.toHaveBeenCalled(); expect(chatCompletion).not.toHaveBeenCalled()
  expect((await readClientNote('alice', receipt)).message).toContain('原文件已变化')
})
test('ASR attempt checkpoint is durable before dispatch and blocks unknown replay', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  jest.mocked(transcribe).mockImplementationOnce(async (_uri, _model, options) => {
    await options.save({ version: 5, model: 'same-asr', duration: 12, source: { size: 100, modifiedMs: 1 }, intervals: [], inFlight: { start: 0, end: 12 } })
    expect(JSON.parse((await Storage.getItem(`vinote:alice:client-note:${receipt.operationId}`))!).inFlight).toBe('asr')
    throw new Error('unknown audio result')
  })
  await launchClientNote('alice', receipt)
  expect((await readClientNote('alice', receipt)).status).toBe('unknown')
  await expect(retryClientNote('alice', receipt)).rejects.toThrow('未确认')
  expect(transcribe).toHaveBeenCalledTimes(1); expect(chatCompletion).not.toHaveBeenCalled()
})
test('confirmed transcription survives LLM rejection; continuation never retranscribes', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  jest.mocked(chatCompletion).mockRejectedValueOnce(new ApiError('not authorized', 403))
  await launchClientNote('alice', receipt)
  await retryClientNote('alice', receipt)
  expect(transcribe).toHaveBeenCalledTimes(1)
  expect(chatCompletion).toHaveBeenCalledTimes(2)
})
test('failed durable LLM marker write dispatches nothing and cannot erase the marker', async () => {
  const receipt = await prepareClientNote('alice', draft)
  const original = jest.mocked(Storage.setItem).getMockImplementation()!
  jest.spyOn(Storage, 'setItem').mockImplementation(async (key, value) => {
    if (key.includes(':client-note:') && JSON.parse(value).inFlight === 'llm') throw new Error('disk unavailable')
    return original(key, value)
  })
  await launchClientNote('alice', receipt)
  expect(chatCompletion).not.toHaveBeenCalled()
  jest.mocked(Storage.setItem).mockImplementation(original)
})
test('model completion arriving after account change is never saved for the new account', async () => {
  const receipt = await prepareClientNote('alice', draft)
  jest.mocked(chatCompletion).mockImplementationOnce(async () => {
    jest.mocked(readAccountId).mockResolvedValue('bob')
    return { choices: [{ message: { content: '# 旧账号结果' }, finish_reason: 'stop' }] } as never
  })
  await launchClientNote('alice', receipt)
  expect((await Storage.getAllKeys()).some(k => k.startsWith('vinote:bob:'))).toBe(false)
  jest.mocked(readAccountId).mockResolvedValue('alice')
  expect((await readClientNote('alice', receipt)).status).toBe('unknown')
})

test('clearing the intake or changing model IDs cannot launder an unknown source into a new operation', async () => {
  const receipt = await prepareClientNote('alice', draft)
  jest.mocked(chatCompletion).mockRejectedValueOnce(new Error('lost reply'))
  await launchClientNote('alice', receipt)
  await expect(prepareClientNote('alice', draft)).rejects.toThrow('此来源有未确认')
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})

test('copied media with equal bytes cannot hide an unknown request behind a new file path and UUID', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  jest.mocked(chatCompletion).mockRejectedValueOnce(new Error('lost model result'))
  await launchClientNote('alice', receipt)
  const api = require('../src/lib/integration') as { operationId: jest.Mock }
  api.operationId.mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
  const copied = { ...legacyAudio, file: { ...legacyAudio.file, id: 'new-copy', uri: 'file:///documents/recordings/accounts/alice/new-copy.m4a' } }
  await expect(prepareClientNote('alice', copied)).rejects.toThrow('此来源有未确认')
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})

test('fragment aliases cannot repeat a URL with an unknown model result', async () => {
  const first = await prepareClientNote('alice', draft)
  jest.mocked(chatCompletion).mockRejectedValueOnce(new Error('lost response'))
  await launchClientNote('alice', first)
  await expect(prepareClientNote('alice', { ...draft, url: draft.url + '#part' })).rejects.toThrow('此来源有未确认')
  expect(chatCompletion).toHaveBeenCalledTimes(1)
  expect(integrationJson).toHaveBeenCalledTimes(1)
})
test.each([false, true])('different URLs with equal extracted text block unknown replay even if source sha differs: %s', async differentHash => {
  const first = await prepareClientNote('alice', draft)
  jest.mocked(chatCompletion).mockRejectedValueOnce(new Error('lost response'))
  await launchClientNote('alice', first)
  const control = require('../src/lib/integration') as { operationId: jest.Mock }
  control.operationId.mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
  if (differentHash) jest.mocked(integrationJson).mockResolvedValueOnce({ ...extracted, source_sha256: 'c'.repeat(64) })
  const second = await prepareClientNote('alice', { ...draft, url: 'https://different.example/same-body' })
  await launchClientNote('alice', second)
  expect((await readClientNote('alice', second)).message).toContain('此正文有未确认')
  expect(integrationJson).toHaveBeenCalledTimes(2)
  expect(chatCompletion).toHaveBeenCalledTimes(1)
})

test('a client record with prior dispatch evidence cannot be laundered through pending recovery', async () => {
  mockOriginal()
  const receipt = await prepareClientNote('alice', legacyAudio)
  const key = `vinote:alice:client-note:${receipt.operationId}`
  const record = JSON.parse((await Storage.getItem(key))!)
  record.status = 'running'; record.inFlight = 'asr'
  await Storage.setItem(key, JSON.stringify(record))
  await expect(recoverPreparedClientNote('alice', legacyAudio, receipt.operationId!)).rejects.toThrow('尚未派发')
  expect(transcribe).not.toHaveBeenCalled(); expect(chatCompletion).not.toHaveBeenCalled()
})
