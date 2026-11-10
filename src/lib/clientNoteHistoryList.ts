import Storage from '@react-native-async-storage/async-storage'
import { readClientNote, type ClientNote } from './clientNotePipeline'
import type { IntakeDraft } from './noteIntake'

export type ClientNoteHistoryItem = {
  operationId: string; taskId?: string; title: string; submittedAt: string
  status: ClientNote['status'] | 'unavailable'; message: string; draft?: IntakeDraft
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i

export function savedNoteForClientTask(item: ClientNoteHistoryItem, notes: Array<{ id: string; task_id?: string | null; deleted?: boolean }>): string | undefined {
  if (item.status !== 'success' || !item.taskId) return undefined
  const ids = [...new Set(notes.filter(note => !note.deleted && note.task_id === item.taskId).map(note => note.id).filter(Boolean))]
  return ids.length === 1 ? ids[0] : undefined
}

/** Read each durable local note operation; never submit, resume, or query inference here. */
export async function listClientNoteHistory(owner: string, guard: () => Promise<void>): Promise<ClientNoteHistoryItem[]> {
  if (!owner) throw new Error('请登录后读取任务')
  await guard()
  const prefix = `vinote:${owner}:client-note:`
  const keys = (await Storage.getAllKeys()).filter(key => key.startsWith(prefix) && uuid.test(key.slice(prefix.length)))
  await guard()
  const items: ClientNoteHistoryItem[] = []
  for (const key of keys) {
    await guard()
    const operationId = key.slice(prefix.length)
    const fallback: ClientNoteHistoryItem = { operationId, title: '无法读取的来源任务', submittedAt: '', status: 'unavailable', message: '处理记录暂时无法核验，原记录已保留。' }
    try {
      const raw = await Storage.getItem(key)
      await guard()
      const saved = raw ? JSON.parse(raw) as ClientNote : undefined
      if (!saved || saved.owner !== owner || saved.operationId !== operationId || !saved.draft || saved.draft.operationId !== operationId) { items.push(fallback); continue }
      const record = await readClientNote(owner, saved.draft)
      await guard()
      const draft = record.draft
      const title = draft.mode === 'url' ? draft.url : (draft.file && 'name' in draft.file ? draft.file.name : '音频文件')
      items.push({ operationId, taskId: record.taskId, title: typeof title === 'string' && title ? title : '来源任务',
        submittedAt: typeof draft.submittedAt === 'string' ? draft.submittedAt : '', status: record.status,
        message: typeof record.message === 'string' && record.message ? record.message : '已保存处理记录', draft })
    } catch {
      // A session change must abort the whole read rather than expose stale account rows.
      await guard()
      items.push(fallback)
    }
  }
  await guard()
  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}
