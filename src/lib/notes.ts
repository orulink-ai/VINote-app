import Storage from '@react-native-async-storage/async-storage'
import { ApiError } from './errors'
import { readAccountId } from './storage'
import type { Note } from '../types/api'
import FS from 'react-native-fs'
import Share from 'react-native-share'
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
export async function nextNoteVersion(taskId: string) {
  const versions = (await listNotes()).filter(note => note.task_id === taskId).map(note => note.version || 1)
  return Math.max(0, ...versions) + 1
}
export function noteIdForVersion(taskId: string, version: number) {
  return `app-${taskId}${version === 1 ? '' : `-v${version}`}`
}
export async function createNote(payload: { title: string; content: string; task_id: string }, owner?: string, version?: number) {
  const namespace = await prefix()
  if (owner && namespace !== `vinote:${owner}:note:`) throw new Error('账号已切换，纪要未保存到其他账号')
  const number = version ?? await nextNoteVersion(payload.task_id)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('纪要版本号无效')
  const now = new Date().toISOString()
  const note: Note = { ...payload, id: noteIdForVersion(payload.task_id, number), version: number,
    source_type: 'meeting_recording', generation_client: 'mobile', status: 'done', created_at: now, updated_at: now }
  const key = `${namespace}${note.id}`
  if (await Storage.getItem(key)) throw new Error(`版本 ${number} 的纪要已存在，请刷新录音库后重试`)
  await Storage.setItem(key, JSON.stringify(note))
  return note
}
export async function shareNoteFile(note: Note) {
  const safeTitle = note.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || '会议纪要'
  const directory = `${FS.CachesDirectoryPath}/vinote-share-${note.id}`
  const path = `${directory}/${safeTitle}_v${note.version || 1}.md`
  await FS.mkdir(directory)
  await FS.writeFile(path, note.content, 'utf8')
  // Share.open may resolve before the receiving app reads the file.
  await Share.open({ url: `file://${path}`, type: 'text/markdown', title: `分享${safeTitle}（版本 ${note.version || 1}）`, failOnCancel: false, saveToFiles: true })
}
