import { createNote, nextNoteVersion } from '../../lib/notes'
import { transcribe, summarize } from '../../lib/meetingCloud'
import { loadModels, loadSelection } from '../../lib/models'
import { readAccountId } from '../../lib/storage'
import { LocalRecording, listRecordings, saveRecording } from './recordingLibrary'
import { recordingTitle, summaryTopic } from './recordingTitle'
import { NativeModules } from 'react-native'
import { ApiError, TransportError } from '../../lib/errors'
const active = new Set<string>()
export async function generateRecording(record: LocalRecording, progress: (text: string) => void, resume = false) {
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const key = `${owner}:${record.id}`
  if (active.has(key)) throw new Error('这条录音正在处理中')
  active.add(key)
  let current = record
  let backgroundStarted = false
  const guard = async () => {
    if (await readAccountId() !== owner) throw new Error('账号已切换，处理已停止；已完成进度保留在原账号')
  }
  try {
    const selection = resume && record.generation
      ? { asr_model: record.generation.asrModel, llm_model: record.generation.llmModel }
      : await loadSelection()
    const models = await loadModels()
    for (const kind of ['asr', 'llm'] as const) {
      if (!models.some(m => m.id === selection[`${kind}_model`] && m.modelType === kind && m.runtimeStatus === 'available')) throw new Error('所选模型不可用，请重新选择云端模型')
    }
    const version = record.generation?.version || await nextNoteVersion(record.id)
    current = { ...record, taskId: undefined, error: undefined, summaryCheckpoint: record.generation ? record.summaryCheckpoint : undefined,
      generation: { status: 'pending', asrModel: selection.asr_model, llmModel: selection.llm_model,
        startedAt: record.generation?.startedAt || new Date().toISOString(), version } }
    await saveRecording(current)
    try { backgroundStarted = !!await NativeModules.MeetingProcessing?.start() }
    catch { progress('后台处理未能启动；已保存进度，请保持 App 在前台') }
    // ASR 模型变化时重新转写；总结失败可复用已落盘的完整转写。
    if (!current.transcript || current.asrModel !== selection.asr_model) {
      current = { ...current, transcript: undefined, summaryCheckpoint: undefined }
      const transcript = await transcribe(record.uri, selection.asr_model, {
        checkpoint: current.transcriptionCheckpoint, progress, guard,
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
      checkpoint: current.summaryCheckpoint, progress, guard,
      save: async checkpoint => {
        await guard()
        current = { ...current, summaryCheckpoint: checkpoint }
        await saveRecording(current)
      },
    })
    await guard()
    const topic = summaryTopic(content)
    if (current.titleSource === 'default' && topic) current = { ...current, title: recordingTitle(current.createdAt, topic), titleSource: 'ai' }
    const note = await createNote({ title: current.title, content, task_id: record.id }, owner, version)
    await saveRecording({ ...current, noteId: note.id, llmModel: selection.llm_model, generation: undefined })
    return note.id
  } catch (error) {
    const transient = error instanceof TransportError || (error instanceof ApiError && [502, 503, 504].includes(error.status))
    if (await readAccountId() === owner) await saveRecording({ ...current,
      generation: current.generation && { ...current.generation, status: transient ? 'pending' : 'paused' },
      error: error instanceof Error ? error.message : '处理失败' })
    throw error
  } finally {
    if (backgroundStarted) await NativeModules.MeetingProcessing.stop().catch(() => {})
    active.delete(key)
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
