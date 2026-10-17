import { ASRServiceFailure, readASRDiagnostic, withASRDiagnostic } from '../src/lib/asrFailure'
import { generateRecording, resumePendingRecordings } from '../src/features/recording/generateRecording'
import { listRecordings, saveRecording } from '../src/features/recording/recordingLibrary'
import { transcribe, summarize } from '../src/lib/meetingCloud'
import { createNote, getNote, nextNoteVersion } from '../src/lib/notes'
import { ApiError } from '../src/lib/errors'
import { TransportError } from '../src/lib/errors'
import { loadModels } from '../src/lib/models'
import { analyzeSpeakers } from '../src/lib/meetingSpeakers'
import { getGenerationProgress } from '../src/features/recording/recordingProcessing'
import { acquireGenerationSlot, subscribeGenerationProgress } from '../src/features/recording/recordingProcessing'
import { NativeModules } from 'react-native'
jest.mock('../src/features/recording/recordingLibrary', () => ({ saveRecording: jest.fn(async value => value), listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/meetingSpeakers', () => ({ analyzeSpeakers: jest.fn(async (_, options) => { const checkpoint = { version: 1, provider: 'sherpa-onnx-1.12.35', duration: 600, source: { size: 1, modifiedMs: 1 }, turns: [{ start: 0, end: 10, speakerId: 'speaker_1' }] }; await options.save(checkpoint); return checkpoint }), meetingEvidence: jest.fn((text) => text) }))
jest.mock('../src/lib/meetingCloud', () => ({ transcribe: jest.fn(), summarize: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createNote: jest.fn(), getNote: jest.fn(), nextNoteVersion: jest.fn(async () => 1), noteIdForVersion: jest.fn((id, version) => `app-${id}${version === 1 ? '' : `-v${version}`}`) }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ asr_model: 'asr1', llm_model: 'llm1' })), loadModels: jest.fn(async () => [{ id: 'asr1', modelType: 'asr', runtimeStatus: 'available' }, { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' }]) }))

test('worker forwards independent typed submission and confirmed coverage without parsing legacy percent', async () => {
  let finish!: (text: string) => void
  jest.mocked(transcribe).mockImplementationOnce(async (_uri, _model, options) => {
    options!.asrProgress!({ duration: 100, submittedSeconds: 100, confirmedSeconds: 0 })
    options!.progress('提交识别的音频 100/100 秒；最终转写待确认')
    return new Promise<string>(resolve => { finish = resolve })
  })
  const operation = generateRecording({ id: 'typed-progress', uri: 'file:///original.m4a', title: '会议', createdAt: '', duration: 100 }, () => {})
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(getGenerationProgress()).toMatchObject({ transcriptionPercent: 99, asrProgress: { duration: 100, submittedSeconds: 100, confirmedSeconds: 0 } })
  expect(getGenerationProgress()?.text).not.toContain('转写：已保存')
  expect(createNote).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled()
  finish('final已保存'); await operation
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(transcribe).mockReset().mockResolvedValue('完整转写')
  jest.mocked(summarize).mockReset().mockResolvedValue('# 完整纪要')
  jest.mocked(createNote).mockReset().mockResolvedValue({ id: 'app-a' } as never)
  jest.mocked(loadModels).mockReset().mockResolvedValue([
    { id: 'asr1', modelType: 'asr', runtimeStatus: 'available' }, { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' },
  ])
  jest.mocked(nextNoteVersion).mockResolvedValue(1)
  jest.mocked(getNote).mockRejectedValue(new ApiError('本机未找到这份纪要', 404))
})

test('unsubscribing the source view preserves real worker final save and service cleanup', async () => {
  const previous = NativeModules.MeetingProcessing
  const start = jest.fn(async () => true), stop = jest.fn(async () => {})
  NativeModules.MeetingProcessing = { start, stop }
  const record = { id: 'detached-final', uri: 'file:///original.m4a', title: '会议', createdAt: '', duration: 42 }
  let finish!: (text: string) => void
  jest.mocked(transcribe).mockImplementationOnce(async (_, model, options) => {
    expect(model).toBe('asr1'); await options!.guard!()
    const text = await new Promise<string>(resolve => { finish = resolve })
    await options!.guard!(); options!.progress!('转写进度 100%')
    return text
  })
  const oldView = jest.fn(), newView = jest.fn()
  const detach = subscribeGenerationProgress(oldView)
  let reattach: (() => void) | undefined
  try {
    const worker = generateRecording(record, () => {})
    await new Promise<void>(resolve => setImmediate(resolve))
    detach(); const calls = oldView.mock.calls.length
    expect(start).toHaveBeenCalledTimes(1); expect(stop).not.toHaveBeenCalled()
    expect(createNote).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled()
    expect(() => acquireGenerationSlot()).toThrow()
    reattach = subscribeGenerationProgress(newView)
    finish('完整转写'); await expect(worker).resolves.toBe('app-a')
    expect(oldView).toHaveBeenCalledTimes(calls); expect(newView).toHaveBeenCalled()
    expect(transcribe).toHaveBeenCalledTimes(1); expect(analyzeSpeakers).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ task_id: record.id }), 'alice', 1)
    expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ uri: record.uri, noteId: 'app-a', lastNoteVersion: 1, generation: undefined, transcript: '完整转写', speakerCheckpoint: expect.any(Object) }))
    expect(stop).toHaveBeenCalledTimes(1); expect(getGenerationProgress()).toBeNull()
    acquireGenerationSlot()()
  } finally { detach(); reattach?.(); NativeModules.MeetingProcessing = previous }
})

test('long recordings run ASR and windowed speaker analysis concurrently, keeping both results on a later failure', async () => {
  let finish!: (value: string) => void
  jest.mocked(transcribe).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  jest.mocked(summarize).mockRejectedValueOnce(new Error('summary failed'))
  const record = { id: 'long-memory', uri: 'file:///long.m4a', title: '会议', createdAt: '', duration: 4690 }
  const operation = generateRecording(record, jest.fn())
  const assertion = expect(operation).rejects.toThrow('summary failed')
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(transcribe).toHaveBeenCalledTimes(1)
  expect(analyzeSpeakers).toHaveBeenCalledTimes(1)
  expect(summarize).not.toHaveBeenCalled()
  finish('已保存长录音转写')
  await assertion
  expect(analyzeSpeakers).toHaveBeenCalledTimes(1)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ transcript: '已保存长录音转写', speakerCheckpoint: expect.any(Object) }))
})
test('long ASR failure retains parallel speaker evidence without starting summary', async () => {
  jest.mocked(transcribe).mockRejectedValueOnce(new ApiError('转写服务暂时不可用', 502))
  const record = { id: 'long-gateway', uri: 'file:///long.m4a', title: '会议', createdAt: '', duration: 4690 }
  await expect(generateRecording(record, jest.fn())).rejects.toThrow('转写服务暂时不可用')
  expect(analyzeSpeakers).toHaveBeenCalledTimes(1)
  expect(summarize).not.toHaveBeenCalled()
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({
    generation: expect.objectContaining({ status: 'paused' }),
    errorDetails: expect.objectContaining({ status: 502 }),
  }))
})
test('runs both analyses together and keeps speaker progress when ASR fails', async () => {
  let rejectAsr!: (error: Error) => void
  let speakerStarted!: () => void
  const started = new Promise<void>(resolve => { speakerStarted = resolve })
  const checkpoint = { version: 1 as const, provider: 'sherpa-onnx-1.12.35' as const, duration: 600, source: { size: 1, modifiedMs: 1 }, turns: [{ start: 0, end: 10, speakerId: 'speaker_1' }] }
  jest.mocked(transcribe).mockImplementationOnce(() => new Promise((_, reject) => { rejectAsr = reject }))
  jest.mocked(analyzeSpeakers).mockImplementationOnce(async (_, options) => {
    await options.save(checkpoint)
    speakerStarted()
    return checkpoint
  })
  const progress = jest.fn()
  const operation = generateRecording({ id: 'parallel', uri: 'file:///parallel.m4a', title: '会议', createdAt: '', duration: 600 }, progress)
  const rejected = expect(operation).rejects.toThrow('暂时断网')
  await started
  expect(getGenerationProgress()).toEqual(expect.objectContaining({ owner: 'alice', recordId: 'parallel' }))
  expect(transcribe).toHaveBeenCalled()
  expect(summarize).not.toHaveBeenCalled()
  rejectAsr(new TransportError('暂时断网'))
  await rejected
  expect(getGenerationProgress()).toBeNull()
  expect(progress).toHaveBeenLastCalledWith('转写：失败，已完成识别保留；等待说话人分析保存\n说话人：已保存')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ speakerCheckpoint: checkpoint, generation: expect.objectContaining({ status: 'pending' }) }))
})

test('a permanent speaker failure pauses the task even if ASR also loses network', async () => {
  jest.mocked(transcribe).mockRejectedValueOnce(new TransportError('暂时断网'))
  jest.mocked(analyzeSpeakers).mockRejectedValueOnce(new Error('本机模型不可用'))
  await expect(generateRecording({ id: 'native-failed', uri: 'file:///native.m4a', title: '会议', createdAt: '', duration: 600 }, jest.fn())).rejects.toThrow('本机模型不可用')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ generation: expect.objectContaining({ status: 'paused' }) }))
  expect(summarize).not.toHaveBeenCalled()
})

test('AI topic replaces only automatic titles, never manual names', async () => {
  jest.mocked(summarize).mockResolvedValue('# 产品发布安排与职责确认\n内容')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-title' } as never)
  const record = { id: 'title', uri: 'file:///title.m4a', title: '手动标题', createdAt: '2026-09-23T10:00:00Z', duration: 12, transcript: '内容', asrModel: 'asr1' }
  await generateRecording({ ...record, titleSource: 'manual' }, jest.fn())
  expect(createNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: expect.stringMatching(/^2026-09-23 \d{2}:\d{2}｜产品发布安排与职责确认$/) }), 'alice', 1)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ title: '手动标题' }))
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
  expect(transcribe).toHaveBeenCalledTimes(2)
  expect(transcribe).toHaveBeenCalledWith(record.uri, 'asr1', expect.any(Object))
  expect(summarize).toHaveBeenLastCalledWith('完整转写', '会议', 'llm1', expect.any(Object))
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-a', error: undefined }))
})
test('a pending task resumes its saved models and revalidates unproven legacy text', async () => {
  const record = { id: 'pending', uri: 'file:///pending.m4a', title: '会议', createdAt: '', duration: 600,
    transcript: '已保存的完整转写', asrModel: 'asr1', generation: { status: 'pending' as const, asrModel: 'asr1', llmModel: 'llm1', startedAt: '2026-09-24T00:00:00Z' } }
  jest.mocked(listRecordings).mockResolvedValue([record])
  jest.mocked(summarize).mockResolvedValue('# 完整纪要')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-pending' } as never)
  await resumePendingRecordings(jest.fn())
  expect(transcribe).toHaveBeenCalledWith(record.uri, 'asr1', expect.any(Object))
  expect(summarize).toHaveBeenCalledWith('完整转写', record.title, 'llm1', expect.any(Object))
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
test('an exhausted ASR gateway failure pauses for an explicit retry', async () => {
  jest.mocked(transcribe).mockRejectedValue(new ApiError('转写服务暂时不可用', 502))
  const record = { id: 'gateway', uri: 'file:///gateway.m4a', title: '会议', createdAt: '', duration: 600 }
  await expect(generateRecording(record, jest.fn())).rejects.toThrow('转写服务暂时不可用')
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({
    errorDetails: expect.objectContaining({ status: 502 }),
    generation: expect.objectContaining({ status: 'paused' }),
  }))
})
test('another summary of the same recording uses a new version and fresh summary', async () => {
  jest.mocked(nextNoteVersion).mockResolvedValue(2)
  jest.mocked(summarize).mockResolvedValue('# 第二版')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-repeat-v2' } as never)
  const record = { id: 'repeat', uri: 'file:///repeat.m4a', title: '会议', createdAt: '', duration: 600,
    noteId: 'app-repeat', transcript: '完整转写', asrModel: 'asr1', summaryCheckpoint: { version: 8 as const, model: 'llm1', title: '会议', source: '完整转写', parts: { audit: '# 第一版' } } }
  await generateRecording(record, jest.fn())
  expect(summarize).toHaveBeenCalledWith('完整转写', '会议', 'llm1', expect.objectContaining({ checkpoint: undefined }))
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'repeat' }), 'alice', 2)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-repeat-v2', generation: undefined }))
})
test('deleting the latest note does not reuse its version number', async () => {
  jest.mocked(nextNoteVersion).mockResolvedValue(2)
  jest.mocked(summarize).mockResolvedValue('# 第三版')
  jest.mocked(createNote).mockResolvedValue({ id: 'app-repeat-v3' } as never)
  const record = { id: 'repeat', uri: 'file:///repeat.m4a', title: '会议', createdAt: '', duration: 600,
    transcript: '完整转写', asrModel: 'asr1', lastNoteVersion: 2 }
  await generateRecording(record, jest.fn())
  expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'repeat' }), 'alice', 3)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: 'app-repeat-v3', lastNoteVersion: 3 }))
})
test('a saved note is linked on recovery without overwriting or regenerating it', async () => {
  const note = { id: 'app-recovered-v2', task_id: 'recovered', version: 2, content: '# 原纪要' }
  jest.mocked(getNote).mockResolvedValue(note as never)
  jest.mocked(loadModels).mockRejectedValueOnce(new TransportError('暂时断网'))
  const record = { id: 'recovered', uri: 'file:///recovered.m4a', title: '会议', createdAt: '', duration: 600,
    transcript: '完整转写', asrModel: 'asr1', generation: { status: 'pending' as const, asrModel: 'asr1', llmModel: 'llm1', startedAt: '', version: 2 } }
  await expect(generateRecording(record, jest.fn(), true)).resolves.toBe(note.id)
  expect(summarize).not.toHaveBeenCalled()
  expect(loadModels).not.toHaveBeenCalled()
  expect(createNote).not.toHaveBeenCalled()
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ noteId: note.id, lastNoteVersion: 2, generation: undefined }))
})

test('model access failures retain only diagnostic status, code and request id and preserve the transcript', async () => {
  jest.mocked(summarize).mockRejectedValueOnce(new ApiError('模型暂不可用', 403, { code: 'AccessDenied.Unpurchased', requestId: 'request-123' }))
  const record = { id: 'model-denied', uri: 'file:///original.m4a', title: '会议', createdAt: '', duration: 600,
    transcript: '完整转写', asrModel: 'asr1' }
  await expect(generateRecording(record, jest.fn())).rejects.toThrow('模型暂不可用')
  expect(transcribe).toHaveBeenCalledTimes(1)
  expect(createNote).not.toHaveBeenCalled()
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({ transcript: '完整转写', errorDetails:
    { status: 403, code: 'AccessDenied.Unpurchased', requestId: 'request-123' }, generation: expect.objectContaining({ status: 'paused' }) }))
})

test.each(['service_error', 'rate_limited'])('explicit expired %s retry preserves the original ASR model', async status => {
  jest.mocked(loadModels).mockResolvedValue([
    { id: 'asr1', modelType: 'asr', runtimeStatus: 'not_available', availability: { status, retryAt: Date.now() - 1 } },
    { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' },
  ])
  await generateRecording({ id: 'retry-transient', uri: 'file:///retry.m4a', title: '会议', createdAt: '', duration: 12 }, jest.fn())
  expect(loadModels).toHaveBeenCalledWith(true)
  expect(transcribe).toHaveBeenCalledWith('file:///retry.m4a', 'asr1', expect.any(Object))
})
test.each(['auth_failed', 'quota_exhausted', 'permission_denied'])('%s blocks generation despite expired retryAt', async status => {
  jest.mocked(loadModels).mockResolvedValue([
    { id: 'asr1', modelType: 'asr', runtimeStatus: 'not_available', availability: { status, retryAt: 1 } },
    { id: 'llm1', modelType: 'llm', runtimeStatus: 'available' },
  ])
  await expect(generateRecording({ id: 'blocked', uri: 'file:///a.m4a', title: '会议', createdAt: '', duration: 12 }, jest.fn())).rejects.toThrow('原选择已保留')
  expect(transcribe).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled()
})

it('publishes speaker phase and batch measurements independently while ASR is still running', async () => {
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  let finishSpeaker!: () => void
  const blocked = new Promise<void>(resolve => { finishSpeaker = resolve })
  let rejectAsr!: (error: Error) => void
  jest.mocked(transcribe).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectAsr = reject }))
  jest.mocked(analyzeSpeakers).mockImplementationOnce(async (_uri, options) => {
    options.progress('检测', { phase: 'detection', attempt: 'test', percent: 100, unit: { index: 40, total: 40 } })
    options.progress('核对', { phase: 'features', attempt: 'test', percent: 100, unit: { index: 1 } })
    options.progress('核对', { phase: 'features', attempt: 'test', percent: 74, unit: { index: 2 } })
    ready(); await blocked
    const checkpoint = { version: 1 as const, provider: 'sherpa-onnx-1.12.35' as const, duration: 10, source: { size: 1, modifiedMs: 1 }, turns: [] }
    await options.save(checkpoint); return checkpoint
  })
  const pending = generateRecording({ id: 'phase-test', uri: 'file:///original.m4a', title: '会议', createdAt: '', duration: 4691 }, jest.fn())
  const failed = expect(pending).rejects.toThrow('转写失败')
  await started
  expect(getGenerationProgress()).toMatchObject({ speakerPercent: 74, speakerStage: { phase: 'features', attempt: 'test', unit: { index: 2 } } })
  rejectAsr(new ApiError('转写失败', 502)); finishSpeaker(); await failed
  expect(summarize).not.toHaveBeenCalled()
})


test('safe ASR category survives recording persistence, retaining speaker cache and paused retry state', async () => {
  const error = new ASRServiceFailure('empty_result_unverified', 'asr', true, true)
  jest.mocked(transcribe).mockRejectedValueOnce(error)
  const checkpoint = { version: 1 as const, provider: 'sherpa-onnx-1.12.35' as const, duration: 42, source: { size: 1, modifiedMs: 1 }, turns: [] }
  jest.mocked(analyzeSpeakers).mockImplementationOnce(async (_, options) => { await options.save(checkpoint); throw new Error('没有检测到有效发言') })
  await expect(generateRecording({ id: 'empty-synthetic', uri: 'file:///synthetic.m4a', title: '会议', createdAt: '', duration: 42 }, jest.fn())).rejects.toBe(error)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({
    speakerCheckpoint: checkpoint, generation: expect.objectContaining({ status: 'paused', asrModel: 'asr1', llmModel: 'llm1' }),
    errorDetails: { code: 'empty_result_unverified', asrDiagnostic: { category: 2, stage: 2, audioAttempted: 1, sentComplete: 1 } },
  }))
  expect(summarize).not.toHaveBeenCalled()
})

test.each(['unknown', 'pre-audio-transport'])('safe stream diagnostic is persisted without changing %s retry classification or models', async kind => {
  const error = withASRDiagnostic(kind === 'unknown' ? new ASRServiceFailure('unknown_result', 'asr', true, false)
    : new TransportError('连接中断'), { origin: 'socket_close', closeCode: 1006, readerMode: 1,
      submittedBytes: kind === 'unknown' ? 6400 : 0, submittedFrames: kind === 'unknown' ? 1 : 0,
      nativeReadBytes: kind === 'unknown' ? 6400 : 0, nativeReadCount: kind === 'unknown' ? 1 : 0 }, kind === 'unknown', false)
  jest.mocked(transcribe).mockRejectedValueOnce(error)
  await expect(generateRecording({ id: 'synthetic-diagnostic', uri: 'file:///synthetic.m4a', title: '会议', createdAt: '', duration: 42 }, jest.fn())).rejects.toBe(error)
  expect(saveRecording).toHaveBeenLastCalledWith(expect.objectContaining({
    generation: expect.objectContaining({ status: kind === 'unknown' ? 'paused' : 'pending', asrModel: 'asr1', llmModel: 'llm1' }),
    errorDetails: expect.objectContaining({ asrDiagnostic: readASRDiagnostic(error) }),
  }))
  expect(transcribe).toHaveBeenCalledTimes(1); expect(summarize).not.toHaveBeenCalled(); expect(createNote).not.toHaveBeenCalled()
})

test.each(['unknown_result', 'empty_result_unverified', 'asr_incomplete_result'])('old %s cannot be overwritten by new policy, model or explicit retry', async code => {
  const record = { id: 'historical-unknown', uri: 'file:///original', title: 'retained', createdAt: '', duration: 1377,
    errorDetails: { code }, generation: { status: 'paused' as const, asrModel: 'asr1', llmModel: 'llm1', startedAt: '' } }
  const frozen = JSON.stringify(record)
  await expect(generateRecording(record, () => {}, true)).rejects.toThrow('尚未确认')
  await expect(generateRecording(record, () => {}, false)).rejects.toThrow('尚未确认')
  expect(saveRecording).not.toHaveBeenCalled(); expect(loadModels).not.toHaveBeenCalled()
  expect(transcribe).not.toHaveBeenCalled(); expect(analyzeSpeakers).not.toHaveBeenCalled()
  expect(JSON.stringify(record)).toBe(frozen)
})
test('interrupted durable ASR attempt is skipped on foreground and explicit recovery', async () => {
  const record = { id: 'interrupted-asr', uri: 'file:///original', title: 'retained', createdAt: '', duration: 100,
    transcriptionCheckpoint: { version: 5 as const, model: 'asr1', duration: 100, source: { size: 1, modifiedMs: 1 },
      intervals: [{ start: 0, end: 50, text: 'retained final' }], inFlight: { start: 50, end: 90 } },
    generation: { status: 'pending' as const, asrModel: 'asr1', llmModel: 'llm1', startedAt: '' } }
  jest.mocked(listRecordings).mockResolvedValueOnce([record])
  await resumePendingRecordings(() => {})
  await expect(generateRecording(record, () => {}, true)).rejects.toThrow('尚未确认')
  expect(saveRecording).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled(); expect(loadModels).not.toHaveBeenCalled()
})
