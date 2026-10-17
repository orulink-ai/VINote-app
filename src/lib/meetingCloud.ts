import { captureStreamScope, assertStreamScope, assertStreamResultScope } from './sessionGate'
import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { measure, ProcessingOptions } from './processingHelpers'
import { recognizeInterval } from './asrStream'
import { loadModels } from './models'
import { recordedAudioPolicy, type RecordedAudioPolicy } from './recordedAudioPolicy'
import { planRecordedInterval } from './recordedAudioPlanner'
export { summarize, splitTranscript, splitMeetingEvidence } from './meetingSummary'
export type { SummaryCheckpoint } from './meetingSummary'

type SourceFingerprint = { size: number; modifiedMs: number }
type Interval = { start: number; end: number; text: string }
type LegacyCheckpoint = {
  version: 2 | 3 | 4; model: string; duration: number; parts: Array<string | null>
  source?: SourceFingerprint; audioCache?: string
  chunkSeconds?: 12 | 60; completedMinutes?: Array<string | null>
}
type StreamCheckpoint = {
  version: 5; model: string; duration: number; source: SourceFingerprint
  intervals: Interval[]; audioCache?: string; sessionLimit?: number
  inFlight?: { start: number; end: number }
}
export type TranscriptionCheckpoint = LegacyCheckpoint | StreamCheckpoint
const remove = (uri: string) => FS.unlink(uri.replace('file://', '')).catch(() => {})
const renderTranscript = (intervals: Interval[]) => intervals.map(part =>
  `[录音区间 ${part.start.toFixed(3)}–${part.end.toFixed(3)} 秒]\n${part.text || '（本区间未识别到语音）'}`).join('\n\n')

export function migrateIntervals(cached: TranscriptionCheckpoint, duration: number): Interval[] {
  if (cached.version === 5) return cached.intervals.map(part => ({ ...part }))
  // Old durations recover saved evidence; they do not select new request sizes.
  const seconds = cached.version === 4 ? cached.chunkSeconds! : 60
  const intervals: Interval[] = (cached.completedMinutes || []).flatMap((text, index) =>
    typeof text === 'string' ? [{ start: index * 60, end: Math.min(duration, (index + 1) * 60), text }] : [])
  for (let index = 0; index < cached.parts.length; index++) {
    const text = cached.parts[index], start = index * seconds, end = Math.min(duration, start + seconds)
    if (typeof text === 'string' && start < end && !intervals.some(part => part.start <= start && part.end >= end))
      intervals.push({ start, end, text })
  }
  return intervals.sort((a, b) => a.start - b.start)
}
export async function transcribe(uri: string, model: string, options: ProcessingOptions<TranscriptionCheckpoint> & { recordedAudioPolicy?: RecordedAudioPolicy }) {
  return measure('transcription', () => transcribeAudio(uri, model, options), options.timing)
}
async function transcribeAudio(uri: string, model: string, options: ProcessingOptions<TranscriptionCheckpoint> & { recordedAudioPolicy?: RecordedAudioPolicy }) {
  if (options.checkpoint?.version === 5 && options.checkpoint.inFlight) throw new Error('上次转写区间结果尚未确认，不能重新发送；原录音和历史进度保留')
  const audio = NativeModules.MeetingAudio
  if (!audio?.toWav || !audio?.wavInfo) throw new Error('当前安装包缺少音频读取能力，请更新 App；原录音保留')
  await options.guard()
  const scope = captureStreamScope(options.owner)
  const guard = async () => { await options.guard(); assertStreamScope(scope) }
  const stat = await FS.stat(uri.replace('file://', ''))
  const source = { size: Number(stat.size), modifiedMs: new Date(stat.mtime).getTime() }
  if (!Number.isFinite(source.size) || source.size <= 0 || !Number.isFinite(source.modifiedMs)) throw new Error('无法读取原录音，已保存进度保留')
  const cached = options.checkpoint
  const reusable = cached && cached.model === model && cached.source?.size === source.size &&
    cached.source?.modifiedMs === source.modifiedMs && Number.isFinite(cached.duration) && cached.duration > 0
  if (cached && !reusable) throw new Error('原转写进度与当前音源或模型不一致，已保留历史进度，未发送音频')
  let wav: string | undefined, complete = false, saved = false
  try {
    if (reusable && cached.audioCache) {
      try { if (await audio.wavInfo(cached.audioCache) === cached.duration) wav = cached.audioCache }
      catch { /* Missing temporary audio is rebuilt; saved text remains. */ }
    }
    if (!wav) {
      options.progress('正在读取录音，已完成的识别会保留…')
      wav = await measure('audio-prepare', () => audio.toWav(uri) as Promise<string>, options.timing)
    }
    if (!wav || wav === uri) throw new Error('音频读取没有生成独立缓存')
    const duration: number = await audio.wavInfo(wav)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('录音没有有效音频')
    if (reusable && cached.duration !== duration) throw new Error('音频时长与历史进度不一致，已保留进度，未发送音频')
    const intervals = reusable && cached.duration === duration ? migrateIntervals(cached, duration) : []
    let previous = 0
    for (const part of intervals) {
      if (!Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start < previous || part.end <= part.start ||
        part.end > duration || typeof part.text !== 'string') throw new Error('旧转写进度区间不完整，已保留，未发送音频')
      previous = part.end
    }
    const checkpoint: StreamCheckpoint = { version: 5, model, duration, source, intervals, audioCache: wav,
      ...(reusable && cached.version === 5 && cached.sessionLimit ? { sessionLimit: cached.sessionLimit } : {}) }
    const save = async () => {
      await options.guard()
      assertStreamResultScope(scope)
      await options.save({ ...checkpoint, intervals: checkpoint.intervals.map(part => ({ ...part })) })
      saved = true
      assertStreamResultScope(scope)
    }
    // Fully confirmed historical coverage needs no policy/network request.
    const completeCoverage = intervals.length > 0 && intervals[0].start === 0 && intervals.at(-1)!.end === duration &&
      intervals.every((part, index) => index === 0 || part.start === intervals[index - 1].end)
    let policy = recordedAudioPolicy({ capabilities: { recordedAudio: options.recordedAudioPolicy } })
    if (!completeCoverage && !policy) {
      await guard()
      const models = await loadModels(true)
      await guard()
      policy = recordedAudioPolicy(models.find(value => value.modelType === 'asr' && value.id === model))
      if (!policy) throw new Error('当前服务的录音转写尚未就绪，请更新服务后重试。')
    }
    await save()
    const report = (submittedSeconds: number) => options.asrProgress?.({ duration,
      submittedSeconds, confirmedSeconds: checkpoint.intervals.reduce((sum, part) => sum + part.end - part.start, 0) })
    let start = 0
    while (start < duration) {
      await options.guard()
      const existing = checkpoint.intervals.find(part => part.start <= start && part.end > start)
      if (existing) { start = existing.end; continue }
      const next = checkpoint.intervals.find(part => part.start > start)?.start ?? duration
      options.progress('正在整理音频分段')
      const planned = await measure('audio-plan', () => planRecordedInterval(wav!, start, next, policy!.maxSessionAudioBytes, guard), options.timing)
      const end = planned.end
      // Technical classification stays in the bounded diagnostic timing record.
      options.timing?.({ stage: `audio-boundary-${planned.boundary}`, durationMs: 0,
        bytes: (Math.round(end * 16000) - Math.round(start * 16000)) * 2 })
      const confirmed = checkpoint.intervals.reduce((sum, part) => sum + part.end - part.start, 0)
      report(confirmed)
      options.progress(`正在识别 · 已保存 ${Math.floor(confirmed)}/${Math.floor(duration)} 秒`)
      // Durable attempt marker precedes the only call. Crashes, failed writes and
      // unknown outcomes cannot turn an unconfirmed interval into a retryable gap.
      checkpoint.inFlight = { start, end }
      await save()
      await guard()
      const text = await measure('asr-request', () => recognizeInterval(wav!, model, start, end, options.owner,
        guard, seconds => {
          if (!Number.isFinite(seconds) || seconds < 0) return
          const submitted = Math.min(duration, confirmed + Math.min(end - start, seconds))
          report(submitted)
          options.progress(`提交识别的音频 ${Math.floor(submitted)}/${Math.ceil(duration)} 秒（按服务回报）；最终转写待确认`)
        }, undefined, () => {
          assertStreamScope(scope)
          options.progress('失败，原录音和已完成识别保留；正在释放转写资源')
        }), options.timing)
      await guard()
      assertStreamResultScope(scope)
      delete checkpoint.inFlight
      checkpoint.intervals.push({ start, end, text })
      checkpoint.intervals.sort((a, b) => a.start - b.start)
      await save()
      const confirmedSeconds = checkpoint.intervals.reduce((sum, part) => sum + part.end - part.start, 0)
      report(confirmedSeconds)
      options.progress(`转写已保存 · ${Math.floor(confirmedSeconds / duration * 100)}% · ${Math.floor(confirmedSeconds)}/${Math.floor(duration)} 秒`)
      start = end
    }
    if (!checkpoint.intervals.some(part => part.text.trim())) throw new Error('未识别到有效语音，请检查录音后重试')
    delete checkpoint.audioCache
    await save(); complete = true
    return renderTranscript(checkpoint.intervals)
  } finally { if (wav && wav !== uri && (complete || (!saved && wav !== cached?.audioCache))) await remove(wav) }
}
