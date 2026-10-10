import { apiJson, ApiError } from './api'
import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { retry, mapConcurrent, createSerialQueue, measure, ProcessingOptions } from './processingHelpers'
export { summarize, splitTranscript, splitMeetingEvidence } from './meetingSummary'
export type { SummaryCheckpoint } from './meetingSummary'
type SourceFingerprint = { size: number; modifiedMs: number }
export type TranscriptionCheckpoint = {
  version: 2 | 3; model: string; duration: number; parts: Array<string | null>
  source?: SourceFingerprint; audioCache?: string
}
const remove = (uri: string) => FS.unlink(uri.replace('file://', '')).catch(() => {})
const EMPTY_ASR_MESSAGES = new Set([
  'Aliyun ASR returned an empty transcript.', 'Volcengine ASR returned an empty transcript.',
])
const renderTranscript = (parts: Array<string | null>) => parts.map((text, index) =>
  `[录音第 ${index} 分钟起]\n${text || '（本段未识别到语音）'}`).join('\n\n')

export async function transcribe(uri: string, model: string, options: ProcessingOptions<TranscriptionCheckpoint>) {
  return measure('transcription', () => transcribeAudio(uri, model, options), options.timing)
}

async function transcribeAudio(uri: string, model: string, options: ProcessingOptions<TranscriptionCheckpoint>) {
  const audio = NativeModules.MeetingAudio
  if (!audio?.wavChunk) throw new Error('当前平台尚未提供分段音频转换，请安装包含原生音频模块的新版 App')
  await options.guard()
  const stat = await FS.stat(uri.replace('file://', ''))
  const source = { size: Number(stat.size), modifiedMs: new Date(stat.mtime).getTime() }
  const cached = options.checkpoint
  const sameSource = cached?.version === 3 && cached.source?.size === source.size && cached.source?.modifiedMs === source.modifiedMs
  if (sameSource && cached.model === model && Number.isFinite(cached.duration) && cached.duration > 0 &&
    cached.parts.length === Math.ceil(cached.duration / 60) && cached.parts.every(part => typeof part === 'string')) {
    if (!cached.parts.some(part => part?.trim())) throw new Error('未识别到有效语音，请检查录音后重试')
    await options.guard()
    return renderTranscript(cached.parts)
  }
  let wav: string | undefined
  let duration = 0
  let durableCache = false
  let completed = false
  try {
    if (sameSource && cached?.audioCache) {
      try {
        duration = await audio.wavInfo(cached.audioCache)
        if (duration === cached.duration && duration > 0) {
          wav = cached.audioCache
          options.timing?.({ stage: 'audio-prepare', durationMs: 0, cacheHit: true })
        }
      } catch { /* The OS can evict temporary files; rebuild without losing text. */ }
    }
    if (!wav) {
      options.progress('正在准备录音，原音频和已完成进度会保留…')
      await options.guard()
      wav = await measure('audio-prepare', () => audio.toWav(uri) as Promise<string>, options.timing)
      duration = await audio.wavInfo(wav)
    }
    if (wav === uri) throw new Error('音频转换没有生成独立临时文件')
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('录音没有有效音频')
    const total = Math.ceil(duration / 60)
    const reusable = cached?.model === model && cached.duration === duration && cached.parts.length <= total &&
      (sameSource || cached.version === 2) && cached.parts.every(part => part === null || typeof part === 'string')
    const checkpoint: TranscriptionCheckpoint = {
      version: 3, model, duration, source, audioCache: wav,
      parts: Array.from({ length: total }, (_, index) => reusable ? cached.parts[index] ?? null : null),
    }
    const serial = createSerialQueue()
    const save = () => serial(async () => {
      await options.guard()
      await options.save({ ...checkpoint, parts: [...checkpoint.parts] })
    })
    await save()
    durableCache = true
    const pending = checkpoint.parts.flatMap((part, index) => part === null ? [index] : [])
    await mapConcurrent(pending, 2, async index => {
      await options.guard()
      const count = checkpoint.parts.filter(part => part !== null).length
      options.progress(`正在转写 ${index + 1}/${total} 段 · 已完成 ${Math.floor(count / total * 100)}%`)
      const chunk = total === 1 ? wav! : await measure('audio-slice', () => audio.wavChunk(wav, index) as Promise<string>, options.timing, index)
      try {
        const result = await measure('asr-request', () => retry(async () => {
          const data = new FormData()
          data.append('file', { uri: chunk, name: 'meeting.wav', type: 'audio/wav' } as unknown as Blob)
          data.append('model', model)
          try { return await apiJson<{ text: string }>('/v1/asr/transcriptions', { method: 'POST', body: data }, options.owner) }
          catch (error) {
            if (error instanceof ApiError && error.status === 502 && EMPTY_ASR_MESSAGES.has(error.message)) return { text: '' }
            throw error
          }
        }, options.guard, options.progress), options.timing, index)
        if (typeof result?.text !== 'string') throw new Error('转写服务返回格式异常，此分段未保存，请重试')
        checkpoint.parts[index] = result.text.trim()
        await save()
        const saved = checkpoint.parts.filter(part => part !== null).length
        const seconds = checkpoint.parts.reduce((sum: number, part, position) => sum +
          (part === null ? 0 : Math.min(60, duration - position * 60)), 0)
        if (saved < total || checkpoint.parts.some(part => part?.trim())) {
          options.progress(`转写已保存 ${saved}/${total} 段 · ${Math.floor(seconds)}/${Math.floor(duration)} 秒 · ${Math.floor(seconds / duration * 100)}%`)
        }
      } finally { if (chunk !== wav && chunk !== uri) await remove(chunk) }
    })
    if (!checkpoint.parts.some(part => part?.trim())) throw new Error('未识别到有效语音，请检查录音后重试')
    delete checkpoint.audioCache
    await save()
    completed = true
    return renderTranscript(checkpoint.parts)
  } finally {
    if (wav && wav !== uri && (completed || !durableCache)) await remove(wav)
  }
}
