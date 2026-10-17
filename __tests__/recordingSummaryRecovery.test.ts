import FS from 'react-native-fs'
import { readAccountId } from '../src/lib/storage'
import { listRecordings, saveRecording, type LocalRecording } from '../src/features/recording/recordingLibrary'
import { prepareRecordingSummary } from '../src/features/recording/recordingSummaryRecovery'
import { generateRecordingSummary, resumePendingRecordings } from '../src/features/recording/generateRecording'
import { transcribe, summarize } from '../src/lib/meetingCloud'
import { analyzeSpeakers } from '../src/lib/meetingSpeakers'
import { createNote, getNote, nextNoteVersion, noteIdForVersion } from '../src/lib/notes'
import { loadModels, loadSelection } from '../src/lib/models'
import { ApiError, TransportError } from '../src/lib/errors'
import { queueAutomaticDelivery } from '../src/lib/feishu'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(), saveRecording: jest.fn(async value => value) }))
jest.mock('../src/lib/meetingCloud', () => ({ migrateIntervals: jest.requireActual('../src/lib/meetingCloud').migrateIntervals, transcribe: jest.fn(), summarize: jest.fn() }))
jest.mock('../src/lib/meetingSpeakers', () => ({ ...jest.requireActual('../src/lib/meetingSpeakers'), analyzeSpeakers: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(), loadSelection: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createNote: jest.fn(), nextNoteVersion: jest.fn(), getNote: jest.fn(), noteIdForVersion: jest.fn() }))
jest.mock('../src/lib/feishu', () => ({ queueAutomaticDelivery: jest.fn(async () => {}) }))

function recording(): LocalRecording {
  const source = { size: 12345, modifiedMs: 1000 }
  return { id: 'sample', title: '原会议', uri: `file://${FS.DocumentDirectoryPath}/recordings/accounts/alice/sample.m4a`,
    createdAt: '2026-10-15', duration: 1377, asrModel: 'aliyun', noteId: 'old-note', lastNoteVersion: 2,
    transcript: '已有正文不是完整性证明',
    transcriptionCheckpoint: { version: 5, model: 'aliyun', duration: 1376.549, source,
      intervals: [{ start: 0, end: 1376.549, text: '全长确认的正文' }] },
    speakerCheckpoint: { version: 1, provider: 'sherpa-onnx-1.12.35', source, duration: 1376.549,
      turns: [{ start: 1, end: 20, speakerId: 'speaker_r2_1' }], clusteringVersion: 2,
      analysis: { version: 2, windowSeconds: 120, completedWindows: 12, totalWindows: 12 } } }
}
let record: LocalRecording
beforeEach(() => {
  jest.clearAllMocks(); record = recording()
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(listRecordings).mockImplementation(async () => [record])
  jest.mocked(FS.stat).mockResolvedValue({ size: 12345, mtime: new Date(1000) } as never)
  jest.mocked(saveRecording).mockImplementation(async value => { record = value; return value })
  jest.mocked(loadModels).mockResolvedValue([{ id: 'deepseek', modelType: 'llm', runtimeStatus: 'available' }])
  jest.mocked(nextNoteVersion).mockResolvedValue(4)
  jest.mocked(createNote).mockResolvedValue({ id: 'new-note' } as never)
  jest.mocked(summarize).mockResolvedValue('# 新纪要')
  jest.mocked(getNote).mockReset().mockRejectedValue(new ApiError('not found', 404))
  jest.mocked(noteIdForVersion).mockImplementation((id, version) => `app-${id}-v${version}`)
})
const confirm = async () => ({ ...(await prepareRecordingSummary(record.id)), confirmed: true as const, llmModel: 'deepseek' })

test('full saved sample creates next version with selected LLM and zero ASR/speaker/selection writes', async () => {
  const oldAsr = record.transcriptionCheckpoint, oldSpeaker = record.speakerCheckpoint
  await generateRecordingSummary(await confirm(), jest.fn())
  expect(transcribe).not.toHaveBeenCalled(); expect(analyzeSpeakers).not.toHaveBeenCalled(); expect(loadSelection).not.toHaveBeenCalled()
  expect(summarize).toHaveBeenCalledWith(expect.stringContaining('全长确认的正文'), '原会议', 'deepseek', expect.objectContaining({ checkpoint: undefined }))
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'sample' }), 'alice', 4)
  expect(record).toMatchObject({ asrModel: 'aliyun', lastNoteVersion: 4, llmModel: 'deepseek' })
  expect(record.transcriptionCheckpoint).toEqual(oldAsr); expect(record.speakerCheckpoint).toEqual(oldSpeaker)
  expect(queueAutomaticDelivery).not.toHaveBeenCalled()
})

test.each(['empty', 'gap', 'overlap', 'fractional', 'unknown', 'source', 'model', 'speaker-partial', 'speaker-source', 'clustering', 'foreign-uri', 'missing'])(
  'rejects %s evidence before model lookup or summary', async damage => {
    const asr = record.transcriptionCheckpoint!; if (asr.version !== 5) throw new Error('fixture')
    if (damage === 'empty') asr.intervals = []
    if (damage === 'gap') asr.intervals[0].start = 1
    if (damage === 'overlap') asr.intervals.push({ start: 1, end: 2, text: 'overlap' })
    if (damage === 'fractional') asr.duration = asr.intervals[0].end = 1.00001
    if (damage === 'unknown') asr.inFlight = { start: 0, end: 1 }
    if (damage === 'source') asr.source.size++
    if (damage === 'model') record.asrModel = 'other'
    if (damage === 'speaker-partial') record.speakerCheckpoint!.analysis!.completedWindows--
    if (damage === 'speaker-source') record.speakerCheckpoint!.source = { size: 3, modifiedMs: 1000 }
    if (damage === 'clustering') delete record.speakerCheckpoint!.clusteringVersion
    if (damage === 'foreign-uri') record.uri = 'file:///other-account/sample.m4a'
    if (damage === 'missing') jest.mocked(listRecordings).mockResolvedValue([])
    await expect(prepareRecordingSummary(record.id)).rejects.toThrow()
    expect(loadModels).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled()
  })

test('changed evidence/account after confirmation cannot submit', async () => {
  const request = await confirm(); record.speakerAliases = { speaker_r2_1: 'changed' }
  await expect(generateRecordingSummary(request, jest.fn())).rejects.toThrow()
  expect(summarize).not.toHaveBeenCalled()
  jest.mocked(readAccountId).mockResolvedValue('bob')
  await expect(generateRecordingSummary(request, jest.fn())).rejects.toThrow()
})

test('old failed summary model/checkpoint cannot override explicit Deepseek', async () => {
  record.generation = { status: 'paused', asrModel: 'aliyun', llmModel: 'old', startedAt: '', version: 3 }
  record.summaryCheckpoint = { version: 10, model: 'old', title: record.title, source: 'old', parts: { draft: 'old' } }
  await generateRecordingSummary(await confirm(), jest.fn())
  expect(summarize).toHaveBeenCalledWith(expect.any(String), record.title, 'deepseek', expect.objectContaining({ checkpoint: undefined }))
})

test('failed summary preserves new model checkpoint; same-model explicit continuation reuses it, never auto-resumes', async () => {
  jest.mocked(summarize).mockImplementationOnce(async (source, title, model, options) => {
    await options.save({ version: 10, source, title, model, parts: { facts: 'confirmed' } })
    throw new TransportError('connection lost')
  })
  await expect(generateRecordingSummary(await confirm(), jest.fn())).rejects.toThrow('connection lost')
  expect(record.generation).toMatchObject({ status: 'paused', llmModel: 'deepseek' })
  const checkpoint = record.summaryCheckpoint
  await resumePendingRecordings(jest.fn()); expect(summarize).toHaveBeenCalledTimes(1)
  await generateRecordingSummary(await confirm(), jest.fn())
  expect(jest.mocked(summarize).mock.calls[1][3].checkpoint).toEqual(checkpoint)
  expect(nextNoteVersion).toHaveBeenCalledTimes(1)
  expect(transcribe).not.toHaveBeenCalled(); expect(analyzeSpeakers).not.toHaveBeenCalled()
})

test('note saved but metadata failed recovers exact owner/task/version/frozen audit without another LLM or catalog call', async () => {
  const request = await confirm()
  jest.mocked(summarize).mockImplementationOnce(async (source, title, model, options) => {
    await options.save({ version: 11, source, title, model, parts: { draft: 'draft', audit: '# saved audit' } })
    return '# saved audit'
  })
  jest.mocked(createNote).mockResolvedValueOnce({ id: 'app-sample-v4' } as never)
  const save = jest.mocked(saveRecording).getMockImplementation()!
  jest.mocked(saveRecording).mockImplementation(async value => {
    if (!value.generation) throw new Error('metadata write failed')
    return save(value)
  })
  await expect(generateRecordingSummary(request, jest.fn())).rejects.toThrow('metadata write failed')
  expect(record.generation?.version).toBe(4)
  jest.mocked(saveRecording).mockImplementation(save)
  jest.mocked(getNote).mockResolvedValueOnce({ id: 'app-sample-v4', task_id: 'sample', version: 4, status: 'done', content: '# saved audit' } as never)
  const modelCalls = jest.mocked(loadModels).mock.calls.length
  await expect(generateRecordingSummary(await confirm(), jest.fn())).resolves.toBe('app-sample-v4')
  expect(getNote).toHaveBeenCalledWith('app-sample-v4', { expectedOwner: 'alice' })
  expect(summarize).toHaveBeenCalledTimes(1); expect(createNote).toHaveBeenCalledTimes(1)
  expect(loadModels).toHaveBeenCalledTimes(modelCalls)
  expect(record).toMatchObject({ noteId: 'app-sample-v4', lastNoteVersion: 4, llmModel: 'deepseek' })
  expect(record.generation).toBeUndefined(); expect(record.error).toBeUndefined()
  expect(transcribe).not.toHaveBeenCalled(); expect(analyzeSpeakers).not.toHaveBeenCalled()
})

test.each(['task', 'version', 'id', 'content', 'deleted', 'model', 'source', 'read-failure'])(
  'saved note recovery fails closed for %s mismatch without a new summary', async damage => {
    const request = await confirm()
    record.generation = { status: 'paused', asrModel: 'aliyun', llmModel: 'deepseek', version: 4, startedAt: '', summaryOnly: { evidenceKey: request.evidenceKey } }
    const evidence = require('../src/lib/meetingSpeakers').meetingEvidence(request.transcript, record.speakerCheckpoint, record.speakerAliases)
    record.summaryCheckpoint = { version: 11, model: 'deepseek', source: evidence, title: record.title, parts: { audit: '# saved audit' } }
    const note = { id: 'app-sample-v4', task_id: 'sample', version: 4, status: 'done', content: '# saved audit', deleted: false }
    if (damage === 'task') note.task_id = 'other'
    if (damage === 'version') note.version = 3
    if (damage === 'id') note.id = 'other'
    if (damage === 'content') note.content = 'unrelated'
    if (damage === 'deleted') note.deleted = true
    if (damage === 'model') record.summaryCheckpoint.model = 'old'
    if (damage === 'source') record.summaryCheckpoint.source = 'old'
    jest.mocked(getNote).mockResolvedValueOnce(note as never)
    if (damage === 'read-failure') jest.mocked(getNote).mockReset().mockRejectedValue(new Error('disk unavailable'))
    await expect(generateRecordingSummary(request, jest.fn())).rejects.toThrow()
    expect(summarize).not.toHaveBeenCalled(); expect(createNote).not.toHaveBeenCalled(); expect(loadModels).not.toHaveBeenCalled()
  })
