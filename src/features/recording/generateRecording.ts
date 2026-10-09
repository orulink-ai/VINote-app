import { createNote, getNote, nextNoteVersion, noteIdForVersion } from '../../lib/notes'
import { transcribe, summarize } from '../../lib/meetingCloud'
import { loadModels, loadSelection } from '../../lib/models'
import { readAccountId } from '../../lib/storage'
import { LocalRecording, listRecordings, saveRecording } from './recordingLibrary'
import { recordingTitle, summaryTopic } from './recordingTitle'
import { NativeModules } from 'react-native'
import { ApiError, TransportError } from '../../lib/errors'
import { measure, ProcessingTiming } from '../../lib/processingHelpers'
import { acquireRecordingLock } from './recordingProcessing'
export async function generateRecording(record: LocalRecording, progress: (text: string) => void, resume = false) {
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const release = acquireRecordingLock(owner, record.id)
  let current = record
  const started = Date.now()
  const timings: ProcessingTiming[] = []
  const timing = (event: ProcessingTiming) => { timings.push(event) }
  let backgroundStarted = false
  const guard = async () => {
    if (await readAccountId() !== owner) throw new Error('账号已切换，处理已停止；已完成进度保留在原账号')
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
          generation: undefined, error: undefined })
        return savedNote.id
      }
    }
    const selection = resume && record.generation
      ? { asr_model: record.generation.asrModel, llm_model: record.generation.llmModel }
      : await loadSelection()
    const models = await measure('models', loadModels, timing)
    for (const kind of ['asr', 'llm'] as const) {
      if (!models.some(m => m.id === selection[`${kind}_model`] && m.modelType === kind && m.runtimeStatus === 'available')) throw new Error('所选模型不可用，请重新选择云端模型')
    }
    const version = record.generation?.version || Math.max((record.lastNoteVersion || 0) + 1, await nextNoteVersion(record.id))
    current = { ...record, taskId: undefined, error: undefined, processingTimings: timings, summaryCheckpoint: record.generation ? record.summaryCheckpoint : undefined,
      generation: { status: 'pending', asrModel: selection.asr_model, llmModel: selection.llm_model,
        startedAt: record.generation?.startedAt || new Date().toISOString(), version } }
    await saveRecording(current)
    try { backgroundStarted = !!await NativeModules.MeetingProcessing?.start() }
    catch { progress('后台处理未能启动；已保存进度，请保持 App 在前台') }
    // ASR 模型变化时重新转写；总结失败可复用已落盘的完整转写。
    if (!current.transcript || current.asrModel !== selection.asr_model) {
      current = { ...current, transcript: undefined, summaryCheckpoint: undefined }
      const transcript = await transcribe(record.uri, selection.asr_model, {
        checkpoint: current.transcriptionCheckpoint, progress, guard, timing, owner,
        save: async checkpoint => {
          await guard()
          current = { ...current, transcriptionCheckpoint: checkpoint }
          await saveRecording(current)
        },
      })
      current = { ...current, transcript, asrModel: selection.asr_model }
      await saveRecording(current)
    }
    progress('转写已保存，正在生成会议纪要…')
    const content = await summarize(current.transcript!, record.title, selection.llm_model, {
      checkpoint: current.summaryCheckpoint, progress, guard, timing, owner,
      save: async checkpoint => {
        await guard()
        current = { ...current, summaryCheckpoint: checkpoint }
        await saveRecording(current)
      },
    })
    await guard()
    const topic = summaryTopic(content)
    const noteTitle = recordingTitle(current.createdAt, topic || (current.titleSource === 'manual' ? current.title : '会议交流'))
    if (current.titleSource === 'default' && topic) current = { ...current, title: noteTitle, titleSource: 'ai' }
    const note = await measure('note-save', () => createNote({ title: noteTitle, content, task_id: record.id }, owner, version), timing)
    timing({ stage: 'total', durationMs: Date.now() - started })
    await saveRecording({ ...current, noteId: note.id, lastNoteVersion: Math.max(current.lastNoteVersion || 0, version),
      llmModel: selection.llm_model, generation: undefined })
    return note.id
  } catch (error) {
    timing({ stage: 'total', durationMs: Date.now() - started })
    const transient = error instanceof TransportError || (error instanceof ApiError && [429, 502, 503, 504].includes(error.status))
    if (await readAccountId() === owner) await saveRecording({ ...current,
      generation: current.generation && { ...current.generation, status: transient ? 'pending' : 'paused' },
      error: error instanceof Error ? error.message : '处理失败' })
    throw error
  } finally {
    if (backgroundStarted) await NativeModules.MeetingProcessing.stop().catch(() => {})
    release()
  }
}

let recovery: Promise<void> | undefined
export function resumePendingRecordings(progress: (text: string) => void): Promise<void> {
  if (recovery) return recovery
  recovery = (async () => {
    for (const record of await listRecordings()) {
      if (record.generation?.status !== 'pending') continue
      try { await generateRecording(record, progress, true) }
      catch { /* generateRecording records the error and pauses this task for manual retry. */ }
    }
  })().finally(() => { recovery = undefined })
  return recovery
}
