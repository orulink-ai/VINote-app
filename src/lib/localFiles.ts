import { identityEpoch } from './sessionIdentity'
import FS from 'react-native-fs'
import Share from 'react-native-share'
import { NativeModules } from 'react-native'
import { readAccountId } from './storage'
import { operationId } from './integration'
import { importRecording } from '../features/recording/recordingLibrary'
import { listLocalFileAssociations, type LocalFileAssociation } from './localFileAssociations'
import { listLocalNotes } from './notes'
import { workspaceViews } from './workspaceStorage'
import { localLibrary } from './localLibrary'
import type { BilibiliSource } from '../types/bilibili'

export type FilePurpose = 'meeting' | 'note'
export type LocalFile = { id: string; name: string; uri: string; size: number; category: 'audio' | 'video' | 'file'; createdAt: string; extension: string; purpose?: FilePurpose; source?: 'import' | 'screen_recording' | 'bilibili'; bilibiliSource?: BilibiliSource }

export async function registerBilibiliFile(owner: string, id: string, uri: string, title: string, size: number, source: BilibiliSource, guard: () => Promise<void>) {
  const { path } = await directory(owner)
  if (!/^[a-f0-9-]{36}$/.test(id) || source.operationId !== id || uri !== `file://${FS.CachesDirectoryPath}/bilibili-${id}.m4a` || !Number.isSafeInteger(size) || size <= 0) throw new Error('下载文件登记无效，未提交生成')
  const target = `${path}/${id}.m4a`, metadata = `${path}/${id}.meta.json`, temporary = metadata + '.tmp'
  let moved = false, committed = false
  await guard(); await FS.mkdir(path); await guard()
  if (await FS.exists(target) || await FS.exists(metadata) || await FS.exists(temporary)) throw new Error('原下载文件已保留，请到文件库查看，不会覆盖')
  if (Number((await FS.stat(uri)).size) !== size) throw new Error('下载文件不完整，未提交生成')
  const file: LocalFile = { id, uri: `file://${target}`, name: `${title}.m4a`, size, category: 'audio', extension: 'm4a', purpose: 'note', source: 'bilibili', bilibiliSource: source, createdAt: new Date().toISOString() }
  try {
    await guard(); await FS.moveFile(uri, target); moved = true; await guard()
    await FS.writeFile(temporary, JSON.stringify(file), 'utf8'); await guard()
    await FS.moveFile(temporary, metadata); committed = true; await guard()
    return file
  } finally {
    if (!committed) {
      await FS.unlink(temporary).catch(() => {})
      if (moved) await FS.unlink(target).catch(() => {})
    }
  }
}
const audioExtensions = new Set(['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus'])
const allowed = new Set([...audioExtensions, 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'pdf', 'docx', 'md', 'txt', 'srt', 'vtt', 'json'])
async function directory(expectedOwner?: string) {
  const owner = expectedOwner ?? await readAccountId()
  if (!owner) throw new Error('请登录后管理文件')
  await checkOwner(owner)
  return { owner, path: `${FS.DocumentDirectoryPath}/files/accounts/${encodeURIComponent(owner)}` }
}
async function checkOwner(owner: string) { if (await readAccountId() !== owner) throw new Error('账号已切换，请重新打开文件库') }
function valid(file: LocalFile, root: string) {
  if (!/^[a-f0-9-]{36}$/.test(file.id) || !allowed.has(file.extension) || file.uri !== `file://${root}/${file.id}.${file.extension}`) throw new Error('文件不属于当前账号')
  if (file.purpose != null && !['meeting', 'note'].includes(file.purpose)) throw new Error('文件用途未核验，原文件保留')
}
export async function verifyLocalFile(file: LocalFile, expectedOwner?: string) {
  const { owner, path } = await directory(expectedOwner)
  valid(file, path)
  if (!await FS.exists(file.uri)) throw new Error('此文件已不在当前设备，请返回文件库刷新')
  await checkOwner(owner)
}
export async function listLocalFiles(expectedOwner?: string): Promise<LocalFile[]> {
  const { owner, path } = await directory(expectedOwner)
  const exists = await FS.exists(path)
  await checkOwner(owner)
  if (!exists) return []
  const entries = await FS.readDir(path), files: LocalFile[] = []
  await checkOwner(owner)
  for (const entry of entries.filter(row => row.name.endsWith('.meta.json'))) {
    const file: LocalFile = JSON.parse(await FS.readFile(entry.path, 'utf8'))
    await checkOwner(owner)
    valid(file, path)
    const purposePath = `${path}/${file.id}.purpose.json`
    if (!file.purpose && await FS.exists(purposePath)) {
      const placement = JSON.parse(await FS.readFile(purposePath, 'utf8'))
      await checkOwner(owner)
      if (placement.owner !== owner || placement.fileId !== file.id || !['meeting', 'note'].includes(placement.purpose)) throw new Error('文件用途记录未核验，原文件保留')
      file.purpose = placement.purpose
    }
    await checkOwner(owner)
    files.push(file)
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export type LocalFileLink = { association: LocalFileAssociation; noteId?: string; noteTitle?: string }
export async function listLocalFileLinks(file: LocalFile, expectedOwner?: string): Promise<LocalFileLink[]> {
  const { owner, path } = await directory(expectedOwner)
  valid(file, path)
  const associations = await listLocalFileAssociations(owner, file.id)
  if (!associations.some(row => row.noteId)) return associations.map(association => ({ association }))
  const [local, snapshot] = await Promise.all([listLocalNotes(owner), localLibrary(owner)])
  await checkOwner(owner)
  const visible = await workspaceViews(local, snapshot)
  await checkOwner(owner)
  return associations.map(association => {
    const mapping = Object.values(snapshot.mappings).find(row => row.localIds.includes(association.noteId || ''))
    const note = visible.find(row => !row.deleted && (row.id === association.noteId || !!mapping && row.workspace_key === mapping.key))
    return { association, ...(note ? { noteId: note.id, noteTitle: note.title } : {}) }
  })
}
export async function importLocalFile(options: { keepAudioInFiles?: boolean; purpose?: FilePurpose; expectedOwner?: string } = {}) {
  const { owner, path } = await directory(options.expectedOwner)
  if (options.purpose != null && !['meeting', 'note'].includes(options.purpose)) throw new Error('请选择会议资料或笔记资料')
  if (!NativeModules.MeetingFiles?.pickFile) throw new Error('文件导入需要更新当前 App 安装包；已有录音与内容仍可使用。')
  const selected: { uri: string; name: string } | null = await NativeModules.MeetingFiles.pickFile()
  if (!selected) return null
  let target = ''
  try {
    if (owner !== await readAccountId()) throw new Error('账号已切换，请重新导入')
    const extension = selected.name.split('.').pop()?.toLowerCase() || ''
    const purpose = options.purpose ?? (options.keepAudioInFiles ? 'note' : 'meeting')
    if (audioExtensions.has(extension) && purpose === 'meeting' && !options.keepAudioInFiles) return await importRecording(selected)
    if (!allowed.has(extension)) throw new Error('此文件格式暂不支持')
    await FS.mkdir(path)
    const id = operationId(); target = `${path}/${id}.${extension}`
    await FS.copyFile(selected.uri, target)
    const size = Number((await FS.stat(target)).size)
    if (!size || size > 2 * 1024 * 1024 * 1024) throw new Error('文件必须在 2 GB 以内且非空')
    const file: LocalFile = { id, name: selected.name, uri: `file://${target}`, size, extension, purpose, source: 'import', category: audioExtensions.has(extension) ? 'audio' : ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension) ? 'video' : 'file', createdAt: new Date().toISOString() }
    if (owner !== await readAccountId()) throw new Error('账号已切换，未保存到另一账号')
    const metadata = `${path}/${id}.meta.json`
    await FS.writeFile(metadata + '.tmp', JSON.stringify(file), 'utf8')
    await FS.moveFile(metadata + '.tmp', metadata)
    return file
  } catch (cause) { if (target) await FS.unlink(target).catch(() => {}); throw cause }
  finally { await NativeModules.MeetingFiles.releaseAudio(selected.uri).catch(() => {}) }
}
// Old originals carry no reliable purpose. A separate placement record leaves
// their original binary, metadata, source/task/note associations untouched.
export async function setLocalFilePurpose(file: LocalFile, purpose: FilePurpose, expectedOwner: string): Promise<LocalFile> {
  const { owner, path } = await directory(expectedOwner)
  valid(file, path)
  if (!['meeting', 'note'].includes(purpose)) throw new Error('请选择会议资料或笔记资料')
  const metadata: LocalFile = JSON.parse(await FS.readFile(`${path}/${file.id}.meta.json`, 'utf8'))
  await checkOwner(owner)
  valid(metadata, path)
  if (metadata.id !== file.id || metadata.uri !== file.uri || metadata.size !== file.size) throw new Error('文件已变化，请刷新后选择用途')
  if (metadata.source === 'screen_recording' && purpose !== 'meeting') throw new Error('录屏属于会议资料，不改变关联内容')
  if (metadata.purpose) throw new Error('文件已有用途，请刷新文件库')
  const placement = `${path}/${file.id}.purpose.json`
  if (await FS.exists(placement)) throw new Error('文件已有用途，请刷新文件库')
  await checkOwner(owner)
  const temporary = `${placement}.${operationId()}.tmp`
  await FS.writeFile(temporary, JSON.stringify({ owner, fileId: file.id, purpose }), 'utf8')
  try {
    await checkOwner(owner)
    await FS.moveFile(temporary, placement)
    await checkOwner(owner)
    return { ...metadata, purpose }
  } finally { if (await FS.exists(temporary)) await FS.unlink(temporary).catch(() => {}) }
}
export async function deleteLocalFile(file: LocalFile, expectedOwner?: string, epoch = identityEpoch(), current: () => boolean = () => true) {
  const { owner, path } = await directory(expectedOwner); valid(file, path)
  const guard = async () => {
    if (!current() || identityEpoch() !== epoch) throw new Error('原删除确认已失效，请重新打开核对文件状态')
    await checkOwner(owner)
    if (!current() || identityEpoch() !== epoch) throw new Error('原删除确认已失效，请重新打开核对文件状态')
  }
  for (const target of [file.uri, `${path}/${file.id}.meta.json`, `${path}/${file.id}.purpose.json`]) {
    await guard()
    const exists = await FS.exists(target)
    await guard()
    if (exists) { await FS.unlink(target); await guard() }
  }
}
export async function exportLocalFile(file: LocalFile) {
  const { path } = await directory(); valid(file, path)
  if (!await FS.exists(file.uri)) throw new Error('文件在当前设备不可用')
  await Share.open({ url: file.uri, title: file.name, failOnCancel: false, saveToFiles: true })
}
export async function readTextFile(file: LocalFile) {
  const { path } = await directory(); valid(file, path)
  if (!['md', 'txt', 'srt', 'vtt'].includes(file.extension) || file.size > 1024 * 1024) throw new Error('只支持读取 1 MB 以内的文字或字幕文件')
  return FS.readFile(file.uri, 'utf8')
}
