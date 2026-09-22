import { apiJson } from './api'
import type { Note, TaskStatus } from '../types/api'

export function listNotes() { return apiJson<Note[]>('/api/notes?scope=personal') }
export function getNote(id: string) { return apiJson<Note>(`/api/notes/${id}`) }

export async function uploadMeetingRecording(uri: string, title: string) {
  const data = new FormData()
  data.append('file', { uri, name: `vinote-${Date.now()}.m4a`, type: 'audio/mp4' } as unknown as Blob)
  data.append('source_type', 'audio')
  data.append('title', title)
  data.append('style', 'meeting')
  data.append('summary_mode', 'default')
  data.append('workflow', 'meeting')
  data.append('trace_source', 'local_file')
  data.append('diarize', 'true')
  data.append('meeting_mode', 'minutes')
  data.append('meeting_type', 'audio')
  data.append('output_language', 'zh-CN')
  return apiJson<{ task_id: string }>('/api/generate_from_upload', { method: 'POST', body: data })
}

export async function waitForTask(taskId: string, onProgress?: (status: TaskStatus) => void) {
  for (;;) {
    const status = await apiJson<TaskStatus>(`/api/task/${taskId}`)
    onProgress?.(status)
    if (status.status === 'success') return status
    if (status.status === 'failed' || status.status === 'not_found') {
      throw new Error(status.message || '会议纪要生成失败')
    }
    await new Promise<void>(resolve => setTimeout(resolve, 2000))
  }
}

export function createNote(payload: { title: string; content: string; task_id: string }) {
  return apiJson<Note>('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ ...payload, source_type: 'meeting_recording', status: 'done' }),
  })
}
