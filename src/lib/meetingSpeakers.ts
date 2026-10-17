import type { SpeakerProgress } from './speakerProgress'
import { NativeEventEmitter, NativeModules } from 'react-native'
import FS from 'react-native-fs'
import type { ProcessingOptions } from './processingHelpers'
import { refineSpeakerGroups } from './speakerClustering'

export type SpeakerTurn = { start: number; end: number; speakerId: string }
export type SpeakerCheckpoint = {
  version: 1
  provider: 'sherpa-onnx-1.12.35'
  source: { size: number; modifiedMs: number }
  duration: number
  turns: SpeakerTurn[]
  analysis?: { version: 2; windowSeconds: 120; completedWindows: number; totalWindows: number }
  clusteringVersion?: 1 | 2
  clustering?: { method: string; reliable: boolean; speakerCount: number; rejectedGroups?: number; silhouette: number; representativeTurns: number; analyzedTurns: number }
}

export function partitionSpeakerTurns(
  segments: { start: number; end: number; speaker: number }[],
  duration: number,
): SpeakerTurn[] {
  const events = new Map<number, [number, number][]>()
  for (const segment of segments) {
    const start = Math.max(0, segment.start),
      end = Math.min(duration, segment.end)
    if (
      ![start, end, segment.speaker].every(Number.isFinite) ||
      end <= start ||
      !Number.isInteger(segment.speaker) ||
      segment.speaker < 0
    )
      throw new Error('说话人分析时间轴无效')
    events.set(start, [...(events.get(start) || []), [segment.speaker, 1]])
    events.set(end, [...(events.get(end) || []), [segment.speaker, -1]])
  }
  const active = new Map<number, number>(),
    labels = new Map<number, string>()
  const turns: SpeakerTurn[] = []
  let previous = 0
  for (const time of [...events.keys()].sort((a, b) => a - b)) {
    const speakers = [...active]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
    for (const id of speakers)
      if (!labels.has(id)) labels.set(id, `speaker_${labels.size + 1}`)
    if (speakers.length && time > previous) {
      const speakerId =
        speakers.length > 1 ? 'speaker_overlap' : labels.get(speakers[0])!
      const last = turns.at(-1)
      if (last?.speakerId === speakerId && last.end === previous)
        last.end = time
      else turns.push({ start: previous, end: time, speakerId })
    }
    for (const [id, delta] of events.get(time)!)
      active.set(id, (active.get(id) || 0) + delta)
    previous = time
  }
  return turns
}

export function speakerLabel(id: string, aliases?: Record<string, string>) {
  if (id === 'speaker_overlap') return '重叠发言 · 归属待确认'
  if (id === 'speaker_unknown') return '说话人待确认'
  if (id.startsWith('speaker_window_')) return '声音组待核验'
  return aliases?.[id] || `说话人 ${id.split('_').at(-1)}`
}

export async function analyzeSpeakers(
  uri: string,
  options: ProcessingOptions<SpeakerCheckpoint>,
): Promise<SpeakerCheckpoint> {
  const started = Date.now()
  await options.guard()
  const stat = await FS.stat(uri.replace('file://', ''))
  const source = {
    size: Number(stat.size),
    modifiedMs: new Date(stat.mtime).getTime(),
  }
  const cached = options.checkpoint
  const sameSource =
    cached?.version === 1 &&
    cached.provider === 'sherpa-onnx-1.12.35' &&
    cached.source.size === source.size &&
    cached.source.modifiedMs === source.modifiedMs &&
    Number.isFinite(cached.duration) && cached.duration > 0
  const validAnalysis = sameSource && cached.analysis?.version === 2 && cached.analysis.windowSeconds === 120 &&
    cached.analysis.totalWindows === Math.ceil(cached.duration / 120) && Number.isInteger(cached.analysis.completedWindows) &&
    cached.analysis.completedWindows >= 0 && cached.analysis.completedWindows <= cached.analysis.totalWindows
  const complete = sameSource && (!cached.analysis || (validAnalysis && cached.analysis.completedWindows === cached.analysis.totalWindows))
  const reusable = complete && cached.turns.length > 0
  if (reusable && cached.clusteringVersion === 2) {
    options.timing?.({ stage: 'speaker-analysis', durationMs: Date.now() - started, cacheHit: true })
    return cached
  }
  const module = NativeModules.MeetingSpeakers
  if (!module?.analyze || !module?.embeddings)
    throw new Error('当前安装包尚无本机说话人模型，请更新 App；转写进度会保留')
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let savedWindows = 0
  let totalWindows = 1
  let featureBatch = 0
  let activeFeatureJob: string | undefined
  let phase: SpeakerProgress['phase'] = 'preparing'
  const emit = (text: string, next: SpeakerProgress['phase'], percent?: number, unit?: SpeakerProgress['unit']) => {
    phase = next
    options.progress(text, { phase, attempt: jobId, percent, unit })
  }
  const listener = new NativeEventEmitter(module).addListener('meetingSpeakerProgress', (raw: Object) => {
    const event = raw as { jobId?: string; progress?: number; phase?: string }
    if (!Number.isFinite(event.progress) || event.progress! < 0 || event.progress! > 100) return
    if (phase === 'features' && event.phase === 'refining' && event.jobId === activeFeatureJob)
      emit(`核对声音特征 · 第 ${featureBatch} 批 ${event.progress}%`, 'features', event.progress, { index: featureBatch })
    else if (phase === 'detection' && event.phase !== 'refining' && event.jobId === jobId)
      emit(`检测发言区间 · 第 ${savedWindows + 1}/${totalWindows} 窗 ${event.progress}%`, 'detection', event.progress, { index: savedWindows + 1, total: totalWindows })
  })
  let wav: string | undefined
  try {
    emit('正在准备说话人分析', 'preparing')
    wav = (await NativeModules.MeetingAudio.toWav(uri)) as string
    if (wav === uri) throw new Error('说话人分析需要独立缓存文件')
    await options.guard()
    emit('正在检测发言区间', 'detection')
    const duration = reusable ? cached.duration : await NativeModules.MeetingAudio.wavInfo(wav) as number
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new Error('说话人分析音频时长无效或超过两小时，原件已保留')
    let turns: SpeakerTurn[] = reusable ? cached.turns.map(turn => ({ ...turn })) : []
    let analysis: SpeakerCheckpoint['analysis'] = reusable ? cached.analysis : undefined
    if (!reusable) {
      if (!module.analyzeWindow && duration > 120) throw new Error('长录音需要新版分窗说话人分析，请更新App；原音频和转写已保留')
      totalWindows = Math.ceil(duration / 120)
      const prior = sameSource && cached.duration === duration && cached.analysis
      const resumable = prior && validAnalysis && cached.turns.every(turn => Number.isFinite(turn.start) &&
        Number.isFinite(turn.end) && turn.start >= 0 && turn.end > turn.start &&
        turn.end <= Math.min(duration, prior.completedWindows * 120))
      if (resumable) {
        savedWindows = prior.completedWindows
        turns = cached.turns.map(turn => ({ ...turn }))
      }
      analysis = { version: 2, windowSeconds: 120, completedWindows: savedWindows, totalWindows }
      for (let index = savedWindows; index < totalWindows; index++) {
        await options.guard()
        const coreStart = index * 120, coreEnd = Math.min(duration, coreStart + 120)
        const start = Math.max(0, coreStart - 5), end = Math.min(duration, coreEnd + 5)
        emit(`检测发言区间 · 第 ${index + 1}/${totalWindows} 窗`, 'detection', undefined, { index: index + 1, total: totalWindows })
        const result = (module.analyzeWindow ? await module.analyzeWindow(wav, start, end, jobId)
          : await module.analyze(wav, jobId)) as { duration: number; segments: { start: number; end: number; speaker: number }[] }
        if (!Number.isFinite(result.duration) || Math.abs(result.duration - (end - start)) > 1 / 16000 || !Array.isArray(result.segments)) {
          throw new Error('说话人分析窗口结果不完整，已保存窗口保留')
        }
        const windowTurns = partitionSpeakerTurns(result.segments, result.duration).flatMap(turn => {
          const absoluteStart = Math.max(coreStart, start + turn.start), absoluteEnd = Math.min(coreEnd, start + turn.end)
          return absoluteEnd > absoluteStart ? [{ start: absoluteStart, end: absoluteEnd,
            speakerId: turn.speakerId === 'speaker_overlap' ? turn.speakerId : `speaker_window_${index}_${turn.speakerId}` }] : []
        })
        const nextTurns = [...turns, ...windowTurns]
        const nextAnalysis: NonNullable<SpeakerCheckpoint['analysis']> = { ...analysis, completedWindows: index + 1 }
        await options.guard()
        await options.save({ version: 1, provider: 'sherpa-onnx-1.12.35', source, duration, turns: nextTurns, analysis: nextAnalysis })
        turns = nextTurns
        analysis = nextAnalysis
        savedWindows = index + 1
        emit(`检测发言区间 · 已保存 ${savedWindows}/${totalWindows} 窗`, 'detection')
      }
    }
    if (!turns.length) throw new Error('没有检测到有效发言，请检查原声')
    const checkpoint: SpeakerCheckpoint = {
      version: 1,
      provider: 'sherpa-onnx-1.12.35',
      source,
      duration,
      turns,
      ...(analysis ? { analysis } : {}),
    }
    // Keep raw intervals before refinement so a feature failure need not rerun
    // full-recording segmentation. Embeddings never enter checkpoints or LLM.
    await options.guard()
    await options.save(checkpoint)
    emit('正在核对较长发言的声音特征…', 'features')
    const refined = await refineSpeakerGroups(turns, async windows => {
      await options.guard()
      activeFeatureJob = `${jobId}-features-${++featureBatch}`
      emit(`核对声音特征 · 第 ${featureBatch} 批`, 'features', undefined, { index: featureBatch })
      try { return await module.embeddings(wav, windows, activeFeatureJob) as (number[] | null)[] }
      finally { activeFeatureJob = undefined; emit('正在核对声音分组…', 'features') }
    })
    const completed: SpeakerCheckpoint = { ...checkpoint, ...refined, clusteringVersion: 2 }
    await options.guard()
    emit('正在保存说话人分析结果…', 'saving')
    await options.save(completed)
    return completed
  } finally {
    options.timing?.({ stage: 'speaker-analysis', durationMs: Date.now() - started })
    listener.remove()
    if (wav && wav !== uri)
      await FS.unlink(wav.replace('file://', '')).catch(() => {})
  }
}

export function meetingEvidence(
  transcript: string,
  speakers: SpeakerCheckpoint,
  aliases?: Record<string, string>,
) {
  return transcript
    .split(/(?=\[录音第 \d+ 分钟起\]|\[录音区间 [\d.]+–[\d.]+ 秒\])/)
    .filter(Boolean)
    .map(section => {
      const marker = section.match(/^\[录音第 (\d+) 分钟起\]/)
      const interval = section.match(/^\[录音区间 ([\d.]+)–([\d.]+) 秒\]/)
      const start = interval ? Number(interval[1]) : marker ? Number(marker[1]) * 60 : 0
      const end = interval ? Math.min(Number(interval[2]), speakers.duration) : marker
        ? Math.min(start + 60, speakers.duration)
        : speakers.duration
      const turns = speakers.turns.filter(
        turn => turn.end > start && turn.start < end,
      )
      return `${section.trim()}\n\n【独立说话人分析 ${start.toFixed(
        1,
      )}–${end.toFixed(1)} 秒】\n${
        turns
          .map(
            turn =>
              `${turn.start.toFixed(2)}–${turn.end.toFixed(
                2,
              )} 秒：${speakerLabel(turn.speakerId, aliases)}`,
          )
          .join('\n') || '本区间说话人待确认'
      }\n转写时间仅为分段边界；没有逐句时间，不据此确定每句说话人。编号仅表示本时间窗有人发声，不对应具体句子；观点与承诺统一用‘有人提出/讨论提到’，不得标为某个说话人编号或姓名。`
    })
    .join('\n\n')
}
