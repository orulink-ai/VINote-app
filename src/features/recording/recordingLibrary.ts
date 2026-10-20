import type { ASRDiagnostic } from '../../lib/asrFailure'
import FS from 'react-native-fs'
import { exportOriginal } from '../../lib/originalMedia'
import { NativeModules } from 'react-native'
import { recordingTitle } from './recordingTitle'
import { readAccountId } from '../../lib/storage'
import type { TranscriptionCheckpoint, SummaryCheckpoint } from '../../lib/meetingCloud'
import type { SpeakerCheckpoint } from '../../lib/meetingSpeakers'
import type { ProcessingTiming } from '../../lib/processingHelpers'
import { listNotes } from '../../lib/notes'
import { acquireRecordingLock, getGenerationProgress } from './recordingProcessing'
import { identityEpoch, SessionScopeChangedError } from '../../lib/sessionIdentity'

const metadataTransactions = new Map<string, Promise<unknown>>()
async function metadataTransaction<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const pending = (metadataTransactions.get(key) || Promise.resolve()).catch(() => {}).then(operation)
  metadataTransactions.set(key, pending)
  try { return await pending } finally { if (metadataTransactions.get(key) === pending) metadataTransactions.delete(key) }
}
async function recordingScope() {
  const owner = await readAccountId(), epoch = identityEpoch()
  if (!owner) throw new Error('请联网登录一次，以确认本机录音所属账号')
  const directory = `${FS.DocumentDirectoryPath}/recordings/accounts/${encodeURIComponent(owner)}`
  const guard = async () => {
    if (identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new SessionScopeChangedError()
  }
  return { owner, directory, guard }
}

export type LocalRecording = { id: string; title: string; uri: string; createdAt: string; duration: number; bookmarks?: Array<{ seconds: number; label: string }>; extension?: string; source?: 'recording' | 'import'; originalName?: string; titleSource?: 'default' | 'manual' | 'ai'; state?: 'recording' | 'saved' | 'interrupted'; transcript?: string; asrModel?: string; llmModel?: string; taskId?: string; noteId?: string; lastNoteVersion?: number; error?: string; errorDetails?: { status?: number; code?: string; requestId?: string; asrDiagnostic?: ASRDiagnostic }; processingTimings?: ProcessingTiming[]; transcriptionCheckpoint?: TranscriptionCheckpoint; summaryCheckpoint?: SummaryCheckpoint; speakerCheckpoint?: SpeakerCheckpoint; speakerAliases?: Record<string, string>; generation?: { status: 'pending' | 'paused'; asrModel: string; llmModel: string; startedAt: string; version?: number; summaryOnly?: SummaryOnlyGeneration } }
export type SummaryOnlyGeneration = { evidenceKey: string }
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
  const scope = await recordingScope(), directory = scope.directory
  if (!/^[a-zA-Z0-9-]+$/.test(record.id) || record.uri.replace('file://', '') !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音不属于当前账号')
  const body = JSON.stringify(record)
  return metadataTransaction(`${directory}/${record.id}`, async () => {
  await scope.guard()
  await FS.mkdir(directory); await scope.guard()
  const path = `${directory}/${record.id}.json`
  await FS.writeFile(`${path}.tmp`, body, 'utf8'); await scope.guard()
  // iOS moveFile 不覆盖已存在目标；临时文件保留完整状态供中断恢复。
  if (await FS.exists(path)) { await scope.guard(); await FS.unlink(path) }
  await scope.guard(); await FS.moveFile(`${path}.tmp`, path); await scope.guard()
  return JSON.parse(body) as LocalRecording
  })
}
export async function listRecordings(): Promise<LocalRecording[]> {
  const scope = await recordingScope(), directory = scope.directory
  if (!await FS.exists(directory)) { await scope.guard(); return [] }
  await scope.guard()
  const files = await FS.readDir(directory); await scope.guard()
  const ids = new Set(files.map(file => file.name.endsWith('.json.tmp') ? file.name.slice(0, -9) : file.name.endsWith('.json') ? file.name.slice(0, -5) : file.name.slice(0, file.name.lastIndexOf('.'))))
  const results: LocalRecording[] = []
  for (const id of ids) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) continue
    const record = await metadataTransaction(`${directory}/${id}`, async () => {
      await scope.guard()
      let hadMetadata = files.some(file => file.name === `${id}.json` || file.name === `${id}.json.tmp`)
      // Recheck paths after taking the lock, not just the pre-commit directory snapshot.
      for (const suffix of ['.json.tmp', '.json']) {
        const path = `${directory}/${id}${suffix}`
        if (!await FS.exists(path) && !files.some(file => file.name === `${id}${suffix}`)) continue
        hadMetadata = true
        let value: LocalRecording
        try { value = JSON.parse(await FS.readFile(path, 'utf8')) as LocalRecording }
        catch { continue }
        if (value.id !== id || !value.title) continue
        value.uri = `file://${directory}/${id}.${extension(value)}`
        const exists = await FS.exists(value.uri.replace('file://', '')); await scope.guard()
        if (!exists || value.state === 'recording') {
          value.state = 'interrupted'
          value.error = exists ? '录音曾中断，已保留文件；请播放检查完整性后再生成纪要' : '录音文件未找到，记录已保留；请检查是否曾录音成功'
        }
        return value
      }
      const active = getGenerationProgress()
      if (hadMetadata || active?.owner === scope.owner && active.recordId === id) throw new Error('录音信息暂未读取，请重试；不会替换原记录')
      const audio = files.find(file => file.name.startsWith(`${id}.`) && extensions.has(file.name.split('.').pop() || '') && Number(file.size) > 0)
      if (!audio) return null
      await scope.guard()
      return { id, extension: audio.name.split('.').pop(), state: 'interrupted' as const, error: '已找回原音频，请播放检查完整性；文件修改时间不代表录制开始时间', title: recordingTitle('', '已恢复录音'), uri: `file://${directory}/${audio.name}`, createdAt: '', duration: 0 }
    })
    if (record) results.push(record)
  }
  await scope.guard()
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export async function exportRecording(record: LocalRecording) {
  const epoch = identityEpoch()
  const owner = await readAccountId()
  const directory = await accountDirectory()
  if (!owner || directory !== `${FS.DocumentDirectoryPath}/recordings/accounts/${encodeURIComponent(owner)}`) throw new Error('账号已切换，请重新导出')
  const path = record.uri.replace('file://', '')
  if (!/^[a-zA-Z0-9-]+$/.test(record.id) || path !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音不属于当前账号')
  if (!await FS.exists(path)) throw new Error('未找到有效录音文件，原始记录已保留')
  const file = await FS.stat(path)
  if (!file.isFile() || !Number.isFinite(Number(file.size)) || Number(file.size) <= 0) throw new Error('未找到有效录音文件，原始记录已保留')
  if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请重新导出')
  const ext = extension(record)
  // Keep the recording checks above; the shared exporter owns the OS save result
  // and rechecks owner/epoch. Neither layer reads the whole original into JS.
  const result = await exportOriginal({ id: record.id, uri: record.uri,
    name: `${record.title.trim() || '会议录音'}.${ext}`, extension: ext, size: Number(file.size),
    mimeType: ({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg' } as Record<string, string>)[ext] || 'audio/mp4' })
  if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请核对原保存位置')
  return result
}
export async function deleteRecording(record: LocalRecording) {
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const release = acquireRecordingLock(owner, record.id)
  try {
    const directory = await accountDirectory()
    const path = record.uri.replace('file://', '')
    if (path !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音路径无效')
    const current = (await listRecordings()).find(item => item.id === record.id)
    if (!current || current.uri !== record.uri) throw new Error('录音已变化，请刷新后重试')
    if (current.generation?.status === 'pending') throw new Error('录音正在生成纪要，请稍后操作')
    if (await FS.exists(path)) await FS.unlink(path)
    const metadata = `${directory}/${record.id}.json`
    if (await FS.exists(metadata)) await FS.unlink(metadata)
    if (await FS.exists(`${metadata}.tmp`)) await FS.unlink(`${metadata}.tmp`)
  } finally { release() }
}

export async function renameRecording(record: LocalRecording, title: string) {
  const cleanTitle = title.trim()
  if (!cleanTitle || cleanTitle.length > 120) throw new Error('请输入 1–120 字的会议名称')
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const release = acquireRecordingLock(owner, record.id)
  try {
    const directory = await accountDirectory()
    if (record.uri.replace('file://', '') !== `${directory}/${record.id}.${extension(record)}`) throw new Error('录音路径无效')
    const current = (await listRecordings()).find(item => item.id === record.id)
    if (!current || current.uri !== record.uri) throw new Error('录音已变化，请刷新后重试')
    if (current.generation?.status === 'pending') throw new Error('录音正在生成纪要，请稍后操作')
    return await saveRecording({ ...current, title: cleanTitle, titleSource: 'manual' })
  } finally { release() }
}

export async function renameSpeaker(record: LocalRecording, speakerId: string, name: string) {
  const clean = name.trim()
  if (!/^speaker_\d+$/.test(speakerId) || !clean || clean.length > 40) throw new Error('请输入 1–40 字的说话人名称')
  const owner = await readAccountId()
  if (!owner) throw new Error('请重新登录')
  const release = acquireRecordingLock(owner, record.id)
  try {
    const current = (await listRecordings()).find(item => item.id === record.id)
    if (!current || !current.speakerCheckpoint?.turns.some(turn => turn.speakerId === speakerId)) throw new Error('说话人分析已变化，请刷新后重试')
    if (current.generation?.status === 'pending') throw new Error('正在处理录音，请完成后改名')
    return await saveRecording({ ...current, speakerAliases: { ...current.speakerAliases, [speakerId]: clean } })
  } finally { release() }
}

export async function unlinkRecordingNote(noteId: string, deletedVersion: number, taskId?: string | null) {
  const notes = await listNotes()
  for (const record of await listRecordings()) {
    if (record.noteId === noteId || (taskId && record.id === taskId)) {
      const latest = notes.filter(note => note.task_id === record.id)
        .sort((a, b) => (b.version || 1) - (a.version || 1))[0]
      await saveRecording({ ...record, noteId: latest?.id,
        lastNoteVersion: Math.max(record.lastNoteVersion || 0, deletedVersion, latest?.version || 0), error: undefined })
    }
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
export async function importRecording(selection?: { uri: string; name: string }): Promise<LocalRecording | null> {
  const owner = await readAccountId()
  const picked = selection || await NativeModules.MeetingFiles.pickAudio() as { uri: string; name: string } | null
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
