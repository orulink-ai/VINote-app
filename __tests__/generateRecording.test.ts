import { generateRecording } from '../src/features/recording/generateRecording'
import { saveRecording } from '../src/features/recording/recordingLibrary'
import { transcribe, summarize } from '../src/lib/meetingCloud'
import { createNote } from '../src/lib/notes'
jest.mock('../src/features/recording/recordingLibrary', () => ({ saveRecording: jest.fn(async value => value) }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn(), summarize: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createNote: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ asr_model: 'asr1', llm_model: 'llm1' })), loadModels: jest.fn(async () => [{ id: 'asr1', modelType: 'asr', runtimeStatus: 'available' }, { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' }]) }))

beforeEach(() => jest.clearAllMocks())
test('AI topic replaces only automatic titles, never manual names', async () => {
  jest.mocked(summarize).mockResolvedValue('# 产品发布安排与职责确认\n内容')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-title' } as never)
  const record = { id: 'title', uri: 'file:///title.m4a', title: '手动标题', createdAt: '2026-09-23T10:00:00Z', duration: 12, transcript: '内容', asrModel: 'asr1' }
  await generateRecording({ ...record, titleSource: 'manual' }, jest.fn())
  expect(createNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: '手动标题' }), 'alice')
  await generateRecording({ ...record, titleSource: 'default' }, jest.fn())
  expect(createNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: expect.stringContaining('｜产品发布安排与职责确认') }), 'alice')
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
