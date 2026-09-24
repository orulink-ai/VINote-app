import FS from 'react-native-fs'
import Share from 'react-native-share'
import { NativeModules } from 'react-native'
import { recordingTitle } from './recordingTitle'
import { readAccountId } from '../../lib/storage'
import type { TranscriptionCheckpoint, SummaryCheckpoint } from '../../lib/meetingCloud'

export type LocalRecording = { id: string; title: string; uri: string; createdAt: string; duration: number; extension?: string; source?: 'recording' | 'import'; originalName?: string; titleSource?: 'default' | 'manual' | 'ai'; state?: 'recording' | 'saved' | 'interrupted'; transcript?: string; asrModel?: string; llmModel?: string; taskId?: string; noteId?: string; error?: string; transcriptionCheckpoint?: TranscriptionCheckpoint; summaryCheckpoint?: SummaryCheckpoint }
export async function accountDirectory() {
  const account = await readAccountId()
  if (!account) throw new Error('请联网登录一次，以确认本机录音所属账号')
  return `${FS.DocumentDirectoryPath}/recordings/accounts/${encodeURIComponent(account)}`
}
const extensions = new Set(['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg'])
function extension(record: LocalRecording) {
  const value = record.extension || 'm4a'
  if (!extensions.has(value)) throw new Error('不支持的音频格式')
  return value
}
export async function recordingPath(ext = 'm4a') {
  if (!extensions.has(ext)) throw new Error('不支持的音频格式')
  const directory = await accountDirectory()
  await FS.mkdir(directory)
  return `${directory}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
}
export async function saveRecording(record: LocalRecording) {
  const directory = await accountDirectory()
  if (!/^[a-zA-Z0-9-]+$/.test(record.id) || record.uri.replace('file://', '') !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音不属于当前账号')
  await FS.mkdir(directory)
  const path = `${directory}/${record.id}.json`
  await FS.writeFile(`${path}.tmp`, JSON.stringify(record), 'utf8')
  // iOS moveFile 不覆盖已存在目标；临时文件保留完整状态供中断恢复。
  if (await FS.exists(path)) await FS.unlink(path)
  await FS.moveFile(`${path}.tmp`, path)
  return record
}
export async function listRecordings(): Promise<LocalRecording[]> {
  const directory = await accountDirectory()
  if (!await FS.exists(directory)) return []
  const files = await FS.readDir(directory)
  const metadata = files.filter(file => file.name.endsWith('.json') || file.name.endsWith('.json.tmp'))
  const recovered = new Map<string, LocalRecording>()
  for (const file of metadata.sort((a, b) => a.name.endsWith('.tmp') === b.name.endsWith('.tmp') ? 0 : a.name.endsWith('.tmp') ? 1 : -1)) {
    try {
      const record = JSON.parse(await FS.readFile(file.path, 'utf8')) as LocalRecording
      if (/^[a-zA-Z0-9-]+$/.test(record.id) && record.title) {
        // iOS 容器路径可能改变，仅在当前账号目录内重新定位原音频。
        record.uri = `file://${directory}/${record.id}.${extension(record)}`
        const exists = await FS.exists(`${directory}/${record.id}.${extension(record)}`)
        if (!exists || record.state === 'recording') {
          record.state = 'interrupted'
          record.error = exists ? '录音曾中断，已保留文件；请播放检查完整性后再生成纪要' : '录音文件未找到，记录已保留；请检查是否曾录音成功'
        }
        recovered.set(record.id, record)
      }
    } catch { /* 单条损坏元数据不能阻止其他录音展示；原音频仍可恢复。 */ }
  }
  const results = [...recovered.values()]
  // 恢复已结束但元数据尚未写入的录音，避免保存异常后无入口找回。
  for (const file of files.filter(item => extensions.has(item.name.split('.').pop() || '') && Number(item.size) > 0)) {
    if (!results.some(item => item.uri.replace('file://', '') === file.path)) results.push({ id: file.name.slice(0, file.name.lastIndexOf('.')), extension: file.name.split('.').pop(), state: 'interrupted', error: '已找回原音频，请播放检查完整性', title: recordingTitle((file.mtime || new Date()).toISOString(), '已恢复录音'), uri: `file://${file.path}`, createdAt: (file.mtime || new Date()).toISOString(), duration: 0 })
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export async function exportRecording(record: LocalRecording) {
  const directory = await accountDirectory()
  if (record.uri.replace('file://', '') !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音不属于当前账号')
  await Share.open({ url: record.uri, type: ({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg' } as Record<string, string>)[extension(record)] || 'audio/mp4', title: record.title, failOnCancel: false, saveToFiles: true })
}
export async function deleteRecording(record: LocalRecording) {
  const directory = await accountDirectory()
  const path = record.uri.replace('file://', '')
  if (path !== `${directory}/${record.id}.${extension(record)}` || !/^[a-zA-Z0-9-]+$/.test(record.id)) throw new Error('录音路径无效')
  if (await FS.exists(path)) await FS.unlink(path)
  const metadata = `${directory}/${record.id}.json`
  if (await FS.exists(metadata)) await FS.unlink(metadata)
  if (await FS.exists(`${metadata}.tmp`)) await FS.unlink(`${metadata}.tmp`)
}

export async function unlinkRecordingNote(noteId: string) {
  for (const record of await listRecordings()) {
    if (record.noteId === noteId) await saveRecording({ ...record, noteId: undefined, error: undefined })
  }
}

// 开始采集前先落盘元数据，进程终止后仍有可查找的记录。
export async function createRecordingDraft(title: string): Promise<LocalRecording> {
  const path = await recordingPath()
  const createdAt = new Date().toISOString()
  return saveRecording({ id: path.split('/').pop()!.replace(/\.m4a$/, ''), uri: `file://${path}`,
    title: title.trim() || recordingTitle(createdAt), createdAt, duration: 0,
    titleSource: title.trim() ? 'manual' : 'default', source: 'recording', state: 'recording' })
}
export async function finalizeRecording(record: LocalRecording) {
  const path = record.uri.replace('file://', '')
  if (!await FS.exists(path) || Number((await FS.stat(path)).size) <= 0) {
    throw new Error('未找到有效录音文件，已保留录音记录，请重试保存')
  }
  const duration: number = await NativeModules.MeetingAudio.audioInfo(record.uri)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('录音文件不完整，请保留文件并检查')
  return saveRecording({ ...record, duration: Math.round(duration), state: 'saved', error: undefined })
}
export async function importRecording(): Promise<LocalRecording | null> {
  const owner = await readAccountId()
  const picked = await NativeModules.MeetingFiles.pickAudio() as { uri: string; name: string } | null
  if (!picked) return null
  let target: string | undefined
  try {
    if (await readAccountId() !== owner) throw new Error('账号已切换，请重新导入')
    const ext = picked.name.split('.').pop()?.toLowerCase() || ''
    target = await recordingPath(ext)
    await FS.copyFile(picked.uri, target)
    if (Number((await FS.stat(target)).size) <= 0) throw new Error('所选音频为空')
    const createdAt = new Date().toISOString()
    const record: LocalRecording = { id: target.split('/').pop()!.split('.')[0],
      uri: `file://${target}`, extension: ext, source: 'import', originalName: picked.name,
      title: recordingTitle(createdAt, picked.name.replace(/\.[^.]+$/, '').slice(0, 60)),
      titleSource: 'default', createdAt, duration: 0, state: 'saved' }
    const duration: number = await NativeModules.MeetingAudio.audioInfo(record.uri)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('音频没有有效时长')
    return await saveRecording({ ...record, duration: Math.round(duration) })
  } catch (error) {
    if (target) await FS.unlink(target).catch(() => {})
    throw error
  } finally {
    // 系统选择器先复制到缓存，录音库成功接管后即可释放缓存。
    await NativeModules.MeetingFiles.releaseAudio(picked.uri).catch(() => {})
  }
}
