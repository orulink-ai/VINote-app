import { generateRecording, resumePendingRecordings } from '../src/features/recording/generateRecording'
import { listRecordings, saveRecording } from '../src/features/recording/recordingLibrary'
import { transcribe, summarize } from '../src/lib/meetingCloud'
import { createNote, nextNoteVersion } from '../src/lib/notes'
import { TransportError } from '../src/lib/errors'
jest.mock('../src/features/recording/recordingLibrary', () => ({ saveRecording: jest.fn(async value => value), listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn(), summarize: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createNote: jest.fn(), nextNoteVersion: jest.fn(async () => 1) }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ asr_model: 'asr1', llm_model: 'llm1' })), loadModels: jest.fn(async () => [{ id: 'asr1', modelType: 'asr', runtimeStatus: 'available' }, { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' }]) }))

beforeEach(() => { jest.clearAllMocks(); jest.mocked(nextNoteVersion).mockResolvedValue(1) })
test('AI topic replaces only automatic titles, never manual names', async () => {
  jest.mocked(summarize).mockResolvedValue('# 产品发布安排与职责确认\n内容')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-title' } as never)
  const record = { id: 'title', uri: 'file:///title.m4a', title: '手动标题', createdAt: '2026-09-23T10:00:00Z', duration: 12, transcript: '内容', asrModel: 'asr1' }
  await generateRecording({ ...record, titleSource: 'manual' }, jest.fn())
  expect(createNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: '手动标题' }), 'alice', 1)
  await generateRecording({ ...record, titleSource: 'default' }, jest.fn())
  expect(createNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: expect.stringContaining('｜产品发布安排与职责确认') }), 'alice', 1)
})
test('persists transcription before summary and reuses it after failure with selected models', async () => {
  const record = { id: 'a', uri: 'file:///a.m4a', title: '会议', createdAt: '', duration: 12 }
  jest.mocked(transcribe).mockResolvedValue('完整转写')
  jest.mocked(summarize).mockRejectedValueOnce(new Error('503')).mockResolvedValue('# 决议')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-a' } as never)
  await expect(generateRecording(record, jest.fn())).rejects.toThrow('503')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ transcript: '完整转写', asrModel: 'asr1', error: '503' }))
  await generateRecording({ ...record, transcript: '完整转写', asrModel: 'asr1' }, jest.fn())
  expect(transcribe).toHaveBeenCalledTimes(1)
  expect(transcribe).toHaveBeenCalledWith(record.uri, 'asr1', expect.any(Object))
  expect(summarize).toHaveBeenLastCalledWith('完整转写', '会议', 'llm1', expect.any(Object))
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-a', error: undefined }))
})
test('a pending task resumes with its saved models and completed transcript', async () => {
  const record = { id: 'pending', uri: 'file:///pending.m4a', title: '会议', createdAt: '', duration: 600,
    transcript: '已保存的完整转写', asrModel: 'asr1', generation: { status: 'pending' as const, asrModel: 'asr1', llmModel: 'llm1', startedAt: '2026-09-24T00:00:00Z' } }
  jest.mocked(listRecordings).mockResolvedValue([record])
  jest.mocked(summarize).mockResolvedValue('# 完整纪要')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-pending' } as never)
  await resumePendingRecordings(jest.fn())
  expect(transcribe).not.toHaveBeenCalled()
  expect(summarize).toHaveBeenCalledWith(record.transcript, record.title, 'llm1', expect.any(Object))
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-pending', generation: undefined }))
})
test('a failed task becomes paused instead of retrying on every foreground event', async () => {
  const record = { id: 'paused', uri: 'file:///paused.m4a', title: '会议', createdAt: '', duration: 600 }
  jest.mocked(transcribe).mockRejectedValue(new Error('服务不可用'))
  await expect(generateRecording(record, jest.fn())).rejects.toThrow('服务不可用')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ generation: expect.objectContaining({ status: 'paused' }) }))
  jest.mocked(listRecordings).mockResolvedValue([{ ...record, generation: { status: 'paused', asrModel: 'asr1', llmModel: 'llm1', startedAt: '' } }])
  await resumePendingRecordings(jest.fn())
  expect(transcribe).toHaveBeenCalledTimes(1)
})
test('a temporary network failure remains pending for a later foreground resume', async () => {
  jest.mocked(transcribe).mockRejectedValue(new TransportError('暂时断网'))
  await expect(generateRecording({ id: 'offline', uri: 'file:///offline.m4a', title: '会议', createdAt: '', duration: 600 }, jest.fn())).rejects.toThrow('暂时断网')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ generation: expect.objectContaining({ status: 'pending' }), error: '暂时断网' }))
})
test('another summary of the same recording uses a new version and fresh summary', async () => {
  jest.mocked(nextNoteVersion).mockResolvedValue(2)
  jest.mocked(summarize).mockResolvedValue('# 第二版')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-repeat-v2' } as never)
  const record = { id: 'repeat', uri: 'file:///repeat.m4a', title: '会议', createdAt: '', duration: 600,
    noteId: 'app-repeat', transcript: '完整转写', asrModel: 'asr1', summaryCheckpoint: { version: 4 as const, model: 'llm1', title: '会议', source: '完整转写', parts: { audit: '# 第一版' } } }
  await generateRecording(record, jest.fn())
  expect(summarize).toHaveBeenCalledWith('完整转写', '会议', 'llm1', expect.objectContaining({ checkpoint: undefined }))
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'repeat' }), 'alice', 2)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-repeat-v2', generation: undefined }))
})
