import Storage from '@react-native-async-storage/async-storage'
import { ApiError } from './errors'
import { readAccountId } from './storage'
import type { Note } from '../types/api'
async function prefix() {
  const account = await readAccountId()
  if (!account) throw new ApiError('请重新登录', 401)
  return `vinote:${account}:note:`
}
export async function listNotes(): Promise<Note[]> {
  const start = await prefix()
  const keys = (await Storage.getAllKeys()).filter(key => key.startsWith(start))
  const rows = await Promise.all(keys.map(async key => [key, await Storage.getItem(key)] as const))
  return rows.filter(([, value]) => !!value).map(([, value]) => JSON.parse(value!) as Note).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
export async function getNote(id: string): Promise<Note> {
  const value = await Storage.getItem(`${await prefix()}${id}`)
  if (!value) throw new ApiError('本机未找到这份纪要', 404)
  return JSON.parse(value)
}
export async function renameNote(id: string, title: string) {
  const key = `${await prefix()}${id}`
  if (!title.trim() || title.trim().length > 120) throw new Error('请输入 1–120 字的会议名称')
  const note = { ...await getNote(id), title: title.trim(), updated_at: new Date().toISOString() }
  await Storage.setItem(key, JSON.stringify(note))
  return note
}
export async function deleteNote(id: string) { await Storage.removeItem(`${await prefix()}${id}`) }
export async function createNote(payload: { title: string; content: string; task_id: string }, owner?: string) {
  if (owner && owner !== await readAccountId()) throw new Error('账号已切换，纪要未保存到其他账号')
  const now = new Date().toISOString()
  const note: Note = { ...payload, id: `app-${payload.task_id}`, source_type: 'meeting_recording', generation_client: 'mobile', status: 'done', created_at: now, updated_at: now }
  await Storage.setItem(`${await prefix()}${note.id}`, JSON.stringify(note))
  return note
}
