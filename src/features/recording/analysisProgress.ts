import { submissionPercent } from '../../lib/asrProgress'
import type { SpeakerProgress } from '../../lib/speakerProgress'
import type { GenerationProgress } from './recordingProcessing'

export type AnalysisStage = { status: 'preparing' | 'running' | 'complete' | 'failed'; percent?: number; detail?: SpeakerProgress }

function measured(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
}

function stage(text: string, percent: number | undefined, pattern: RegExp): AnalysisStage {
  if (/失败/.test(text)) return { status: 'failed' }
  if (/^(?:转写|说话人)：已保存$/.test(text)) return { status: 'complete', percent: 100 }
  const fallback = Number(text.match(pattern)?.[1])
  const value = measured(percent) ?? measured(Number.isNaN(fallback) ? undefined : fallback)
  return { status: value === undefined ? 'preparing' : 'running', percent: value }
}

export function analysisProgress(progress: GenerationProgress): { transcription: AnalysisStage; speaker: AnalysisStage } | null {
  const [asrText, speakerText] = progress.text.split('\n')
  if (!asrText?.startsWith('转写：') || !speakerText?.startsWith('说话人：')) return null
  return {
    transcription: stage(asrText, submissionPercent(progress.asrProgress), /$^/),
    speaker: /失败/.test(speakerText) || speakerText === '说话人：已保存'
      ? stage(speakerText, undefined, /$^/)
      : progress.speakerStage
        ? { status: 'running', percent: measured(progress.speakerStage.percent), detail: progress.speakerStage }
        : stage(speakerText, undefined, /(?:本机分析|核对声音特征)\s*(\d+)%/),
  }
}
