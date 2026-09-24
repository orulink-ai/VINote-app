import { createNote } from '../../lib/notes'
import { transcribe, summarize } from '../../lib/meetingCloud'
import { loadModels, loadSelection } from '../../lib/models'
import { readAccountId } from '../../lib/storage'
import { LocalRecording, saveRecording } from './recordingLibrary'
import { recordingTitle, summaryTopic } from './recordingTitle'
const active = new Set<string>()
export async function generateRecording(record: LocalRecording, progress: (text: string) => void) {
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const key = `${owner}:${record.id}`
  if (active.has(key)) throw new Error('这条录音正在处理中')
  active.add(key)
  let current = record
  const guard = async () => {
    if (await readAccountId() !== owner) throw new Error('账号已切换，处理已停止；已完成进度保留在原账号')
  }
  try {
    const selection = await loadSelection()
    const models = await loadModels()
    for (const kind of ['asr', 'llm'] as const) {
      if (!models.some(m => m.id === selection[`${kind}_model`] && m.modelType === kind && m.runtimeStatus === 'available')) throw new Error('所选模型不可用，请重新选择云端模型')
    }
    current = { ...record, taskId: undefined, error: undefined }
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
    const note = await createNote({ title: current.title, content, task_id: record.id }, owner)
    await saveRecording({ ...current, noteId: note.id, llmModel: selection.llm_model })
    return note.id
  } catch (error) {
    if (await readAccountId() === owner) await saveRecording({ ...current, error: error instanceof Error ? error.message : '处理失败' })
    throw error
  } finally { active.delete(key) }
}
