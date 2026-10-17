import { recordingASRBlocked, RECORDING_ASR_BLOCKED } from '../../lib/recordingASRSafety'
import { recordedAudioPolicy } from '../../lib/recordedAudioPolicy'
import { submissionPercent, type AsrProgress } from '../../lib/asrProgress'
import { ASRServiceFailure, readASRDiagnostic } from '../../lib/asrFailure'
import type { SpeakerProgress } from '../../lib/speakerProgress'
import { modelEligible } from '../../lib/modelEligibility'
import { createNote, getNote, nextNoteVersion, noteIdForVersion } from '../../lib/notes'
import { queueAutomaticDelivery } from '../../lib/feishu'
import { transcribe, summarize } from '../../lib/meetingCloud'
import { analyzeSpeakers, meetingEvidence } from '../../lib/meetingSpeakers'
import { createSerialQueue } from '../../lib/processingHelpers'
import { loadModels, loadSelection } from '../../lib/models'
import { readAccountId } from '../../lib/storage'
import { identityEpoch } from '../../lib/sessionIdentity'
import { LocalRecording, listRecordings, saveRecording } from './recordingLibrary'
import { recordingTitle, summaryTopic } from './recordingTitle'
import { NativeModules } from 'react-native'
import { ApiError, TransportError } from '../../lib/errors'
import { measure, ProcessingTiming } from '../../lib/processingHelpers'
import { acquireGenerationSlot, acquireRecordingLock, reportGenerationProgress } from './recordingProcessing'
import { prepareRecordingSummary, type SummaryRecoveryConfirmation } from './recordingSummaryRecovery'
export async function generateRecording(record: LocalRecording, onProgress: (text: string) => void, resume = false) {
  if (recordingASRBlocked(record)) throw new Error(RECORDING_ASR_BLOCKED)
  if (record.generation?.summaryOnly) throw new Error('请通过“仅生成纪要”确认总结模型后继续；不会重新转写或分析说话人')
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const epoch = identityEpoch()
  const releaseSlot = acquireGenerationSlot()
  let release: () => void
  try { release = acquireRecordingLock(owner, record.id) }
  catch (error) { releaseSlot(); throw error }
  const progress = (text: string, measured?: { asrProgress?: AsrProgress; transcriptionPercent?: number; speakerPercent?: number; speakerStage?: SpeakerProgress }) => {
    reportGenerationProgress(owner, record.id, text, measured)
    onProgress(text)
  }
  let current = record
  const started = Date.now()
  const timings: ProcessingTiming[] = []
  const timing = (event: ProcessingTiming) => { timings.push(event) }
  let backgroundStarted = false
  const guard = async () => {
    if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，处理已停止；已完成进度保留在原账号')
  }
  try {
    if (record.generation?.version) {
      let savedNote
      try { savedNote = await getNote(noteIdForVersion(record.id, record.generation.version)) }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error }
      if (savedNote) {
        if (savedNote.task_id !== record.id) throw new Error('已保存纪要与录音不匹配，请检查本机数据')
        await guard()
        await saveRecording({ ...record, noteId: savedNote.id,
          lastNoteVersion: Math.max(record.lastNoteVersion || 0, record.generation.version),
          generation: undefined, error: undefined, errorDetails: undefined })
        return savedNote.id
      }
    }
    const selection = resume && record.generation
      ? { asr_model: record.generation.asrModel, llm_model: record.generation.llmModel }
      : await loadSelection()
    const models = await measure('models', () => loadModels(true), timing)
    for (const kind of ['asr', 'llm'] as const) {
      if (!models.some(m => m.id === selection[`${kind}_model`] && m.modelType === kind && modelEligible(m))) throw new Error('所选模型暂不可用，原选择已保留，请刷新状态后重试')
    }
    const version = record.generation?.version || Math.max((record.lastNoteVersion || 0) + 1, await nextNoteVersion(record.id))
    current = { ...record, taskId: undefined, error: undefined, errorDetails: undefined, processingTimings: timings, summaryCheckpoint: record.generation ? record.summaryCheckpoint : undefined,
      generation: { status: 'pending', asrModel: selection.asr_model, llmModel: selection.llm_model,
        startedAt: record.generation?.startedAt || new Date().toISOString(), version } }
    await saveRecording(current)
    try { backgroundStarted = !!await NativeModules.MeetingProcessing?.start() }
    catch { progress('后台处理未能启动；已保存进度，请保持 App 在前台') }
    const serial = createSerialQueue()
    const persist = (patch: Partial<LocalRecording>) => serial(async () => {
      await guard()
      current = { ...current, ...patch }
      await saveRecording(current)
    })
    // Keep successful branches even when the other fails; do not summarize early.
    progress('转写与说话人分析同时进行…')
    let asrText = '正在准备'
    let speakerProgress = '正在准备'
    let transcriptionPercent: number | undefined
    let asrProgress: AsrProgress | undefined
    let speakerPercent: number | undefined
    let speakerStage: SpeakerProgress | undefined
    const reportAnalysis = (branch: 'asr' | 'speaker', text: string, detail?: SpeakerProgress) => {
      if (branch === 'asr') {
        asrText = text
        transcriptionPercent = submissionPercent(asrProgress)
        if (text === '已保存') transcriptionPercent = 100
      } else {
        speakerProgress = text
        speakerStage = detail || (text === '已保存' && speakerStage ? { phase: 'saved', attempt: speakerStage.attempt } : undefined)
        // Each phase/window/batch owns its measurement; never retain the previous 100%.
        speakerPercent = detail?.percent
      }
      progress(`转写：${asrText}\n说话人：${speakerProgress}`, { asrProgress, transcriptionPercent, speakerPercent, speakerStage })
    }
    const transcribeBranch = async () => {
        try {
          {
            // The checkpoint validates source and complete coverage. A nonempty
            // legacy string alone is never proof of full-recording recognition.
            const transcript = await transcribe(record.uri, selection.asr_model, {
              recordedAudioPolicy: recordedAudioPolicy(models.find(m => m.id === selection.asr_model && m.modelType === 'asr')),
              checkpoint: current.transcriptionCheckpoint, asrProgress: value => { asrProgress = value }, progress: text => reportAnalysis('asr', text), guard, timing, owner,
              save: checkpoint => persist({ transcriptionCheckpoint: checkpoint }),
            })
            await persist({ transcript, asrModel: selection.asr_model,
              ...(transcript !== current.transcript ? { summaryCheckpoint: undefined } : {}) })
          }
          reportAnalysis('asr', '已保存')
        } catch (cause) {
          reportAnalysis('asr', '失败，已完成识别保留；等待说话人分析保存')
          throw cause
        }
      }
    const speakerBranch = () => analyzeSpeakers(record.uri, {
        checkpoint: current.speakerCheckpoint, progress: (text, detail) => reportAnalysis('speaker', text, detail), guard, timing, owner,
        save: checkpoint => persist({ speakerCheckpoint: checkpoint }),
      }).then(async checkpoint => {
        await persist({ speakerCheckpoint: checkpoint })
        reportAnalysis('speaker', '已保存')
      }).catch(cause => {
        reportAnalysis('speaker', '失败，等待转写结果保存')
        throw cause
      })
    {
      const analyses = await Promise.allSettled([transcribeBranch(), speakerBranch()])
      // Permanent failures need manual repair even if the other branch lost network.
      const failures = analyses.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      const failed = failures.find(result => !isTransient(result.reason)) || failures[0]
      if (failed?.status === 'rejected') throw failed.reason
    }
    if (!current.speakerCheckpoint) throw new Error('说话人分析未保存，请重试；转写已保留')
    progress('转写与说话人分析已保存，正在生成会议纪要…')
    const evidence = meetingEvidence(current.transcript!, current.speakerCheckpoint, current.speakerAliases)
    const content = await summarize(evidence, record.title, selection.llm_model, {
      checkpoint: current.summaryCheckpoint, progress, guard, timing, owner,
      save: checkpoint => persist({ summaryCheckpoint: checkpoint }),
    })
    await guard()
    const topic = summaryTopic(content)
    const noteTitle = recordingTitle(current.createdAt, topic || (current.titleSource === 'manual' ? current.title : '会议交流'))
    if (current.titleSource === 'default' && topic) current = { ...current, title: noteTitle, titleSource: 'ai' }
    const note = await measure('note-save', () => createNote({ title: noteTitle, content, task_id: record.id }, owner, version), timing)
    timing({ stage: 'total', durationMs: Date.now() - started })
    await saveRecording({ ...current, noteId: note.id, lastNoteVersion: Math.max(current.lastNoteVersion || 0, version),
      llmModel: selection.llm_model, generation: undefined })
    // Keep delivery errors independent from transcription/summary recovery.
    void queueAutomaticDelivery(note, owner).catch(() => undefined)
    return note.id
  } catch (error) {
    timing({ stage: 'total', durationMs: Date.now() - started })
    // A provider 502/503/504 has already exhausted bounded per-segment retries.
    // Re-entering the foreground must not silently repeat the same failed upload.
    const autoResume = error instanceof TransportError && !recordingASRBlocked(current)
    if (await readAccountId() === owner && identityEpoch() === epoch) await saveRecording({ ...current,
      generation: current.generation && { ...current.generation, status: autoResume ? 'pending' : 'paused' },
      error: error instanceof Error ? error.message : '处理失败',
      errorDetails: error instanceof ApiError ? { status: error.status, ...error.details }
        : error instanceof ASRServiceFailure ? { code: error.code, asrDiagnostic: readASRDiagnostic(error) }
        : readASRDiagnostic(error) ? { asrDiagnostic: readASRDiagnostic(error) } : undefined })
    throw error
  } finally {
    if (backgroundStarted) await NativeModules.MeetingProcessing.stop().catch(() => {})
    release()
    releaseSlot()
  }
}

function isTransient(error: unknown) {
  return error instanceof TransportError || (error instanceof ApiError && [429, 502, 503, 504].includes(error.status))
}

/** Explicit text-only operation. This path cannot call either analysis branch. */
export async function generateRecordingSummary(confirmation: SummaryRecoveryConfirmation, onProgress: (text: string) => void) {
  if (confirmation.confirmed !== true || !confirmation.llmModel ||
      await readAccountId() !== confirmation.owner || identityEpoch() !== confirmation.epoch) throw new Error('请重新确认原录音和总结模型')
  const releaseSlot = acquireGenerationSlot()
  let release: () => void
  try { release = acquireRecordingLock(confirmation.owner, confirmation.recordId) }
  catch (error) { releaseSlot(); throw error }
  let current: LocalRecording | undefined
  let backgroundStarted = false
  const owner = confirmation.owner
  const guard = async () => {
    if (await readAccountId() !== owner || identityEpoch() !== confirmation.epoch) throw new Error('账号已切换，纪要处理已停止')
  }
  const progress = (text: string) => { reportGenerationProgress(owner, confirmation.recordId, text); onProgress(text) }
  try {
    const prepared = await prepareRecordingSummary(confirmation.recordId)
    await guard()
    if (prepared.evidenceKey !== confirmation.evidenceKey) throw new Error('原录音或完整结果已变化，请重新核对后确认')
    const record = prepared.record
    const continuing = record.generation?.summaryOnly?.evidenceKey === prepared.evidenceKey && record.generation.llmModel === confirmation.llmModel
    const evidence = meetingEvidence(prepared.transcript, record.speakerCheckpoint!, record.speakerAliases)
    // Recover the durable note before catalog/token/model access. A completed
    // note and a failed recording metadata write must not become another LLM call.
    if (continuing) {
      const version = record.generation!.version
      if (!Number.isInteger(version) || !version || version < 1) throw new Error('纪要版本尚不能核验')
      const noteId = noteIdForVersion(record.id, version)
      let savedNote
      try { savedNote = await getNote(noteId, { expectedOwner: owner }) }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error }
      await guard()
      if (savedNote) {
        const checkpoint = record.summaryCheckpoint
        if (savedNote.id !== noteId || savedNote.task_id !== record.id || savedNote.version !== version ||
            savedNote.status !== 'done' || savedNote.deleted || !savedNote.content?.trim() ||
            checkpoint?.version !== 11 || checkpoint.model !== confirmation.llmModel ||
            checkpoint.title !== record.title || checkpoint.source !== evidence || checkpoint.parts.audit !== savedNote.content) {
          throw new Error('已保存纪要与本次模型或完整材料不匹配，未重新请求总结')
        }
        const latest = await prepareRecordingSummary(record.id)
        if (latest.evidenceKey !== prepared.evidenceKey) throw new Error('完整材料已变化，请重新核对')
        await guard()
        await saveRecording({ ...latest.record, noteId: savedNote.id,
          lastNoteVersion: Math.max(latest.record.lastNoteVersion || 0, version), llmModel: confirmation.llmModel,
          generation: undefined, error: undefined, errorDetails: undefined })
        return savedNote.id
      }
    }
    const models = await loadModels(true)
    await guard()
    if (!models.some(value => value.id === confirmation.llmModel && value.modelType === 'llm' && modelEligible(value))) throw new Error('所选总结模型暂不可用，请重新选择')
    const version = continuing ? record.generation!.version! : Math.max((record.lastNoteVersion || 0) + 1, await nextNoteVersion(record.id))
    if (!Number.isInteger(version) || version < 1) throw new Error('纪要版本尚不能核验')
    current = { ...record, error: undefined, errorDetails: undefined,
      summaryCheckpoint: continuing ? record.summaryCheckpoint : undefined,
      generation: { status: 'paused', asrModel: record.asrModel || record.transcriptionCheckpoint!.model,
        llmModel: confirmation.llmModel, startedAt: continuing ? record.generation!.startedAt : new Date().toISOString(),
        version, summaryOnly: { evidenceKey: prepared.evidenceKey } } }
    await guard(); await saveRecording(current)
    try { backgroundStarted = !!await NativeModules.MeetingProcessing?.start() } catch { /* Foreground operation remains valid. */ }
    const persist = createSerialQueue()
    progress('复用完整转写与说话人结果，仅生成会议纪要…')
    const content = await summarize(evidence, record.title, confirmation.llmModel, {
      checkpoint: current.summaryCheckpoint, owner, guard, progress,
      save: checkpoint => persist(async () => {
        await guard()
        if (checkpoint.model !== confirmation.llmModel || checkpoint.source !== evidence || checkpoint.title !== record.title) throw new Error('纪要检查点与确认模型或来源不一致')
        current = { ...current!, summaryCheckpoint: checkpoint }
        await saveRecording(current)
      }),
    })
    await guard()
    const latest = await prepareRecordingSummary(record.id)
    if (latest.evidenceKey !== prepared.evidenceKey) throw new Error('原录音或完整结果已变化，未保存新纪要')
    const topic = summaryTopic(content)
    const title = recordingTitle(record.createdAt, topic || (record.titleSource === 'manual' ? record.title : '会议交流'))
    const note = await createNote({ title, content, task_id: record.id }, owner, version)
    await guard()
    await saveRecording({ ...current, noteId: note.id, lastNoteVersion: Math.max(record.lastNoteVersion || 0, version),
      llmModel: confirmation.llmModel, generation: undefined, error: undefined, errorDetails: undefined })
    return note.id
  } catch (error) {
    // No automatic LLM replay, including ambiguous transport failures. Keep
    // confirmed summary parts; a later request requires explicit confirmation.
    if (current && await readAccountId() === owner && identityEpoch() === confirmation.epoch) {
      await saveRecording({ ...current, generation: current.generation && { ...current.generation, status: 'paused' },
        error: error instanceof Error ? error.message : '纪要生成未完成',
        errorDetails: error instanceof ApiError ? { status: error.status, ...error.details } : undefined })
    }
    throw error
  } finally {
    if (backgroundStarted) await NativeModules.MeetingProcessing.stop().catch(() => {})
    release(); releaseSlot()
  }
}

let recovery: Promise<void> | undefined
export function resumePendingRecordings(progress: (text: string) => void): Promise<void> {
  if (recovery) return recovery
  recovery = (async () => {
    for (const record of await listRecordings()) {
      if (record.generation?.status !== 'pending' || record.generation.summaryOnly || recordingASRBlocked(record)) continue
      if (record.errorDetails?.status && [429, 502, 503, 504].includes(record.errorDetails.status)) {
        await saveRecording({ ...record, generation: { ...record.generation, status: 'paused' } })
        continue
      }
      try { await generateRecording(record, progress, true) }
      catch { /* generateRecording records the error and pauses this task for manual retry. */ }
    }
  })().finally(() => { recovery = undefined })
  return recovery
}
