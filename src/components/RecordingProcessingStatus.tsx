import { recordingASRBlocked } from '../lib/recordingASRSafety'
import { validAsrProgress } from '../lib/asrProgress'
import { modelDisplay } from '../lib/modelDisplay'
import { speakerPhaseLabel } from '../lib/speakerProgress'
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from './AppText'
import { ProcessingProgress } from './ProcessingProgress'
import { DetailDisclosure } from './DetailDisclosure'
import { colors, styles } from '../design-system/theme'
import type { LocalRecording } from '../features/recording/recordingLibrary'
import type { GenerationProgress } from '../features/recording/recordingProcessing'
import { analysisProgress, type AnalysisStage } from '../features/recording/analysisProgress'
import { sourceRecoveryCopy } from '../lib/sourceRecoveryCopy'
import { loadModels, type CloudModel } from '../lib/models'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { formatDuration } from '../lib/formatDuration'

function AnalysisRow({ label, stage, saved }: { label: string; stage?: AnalysisStage; saved: string }) {
  return <View style={{ gap: 6, paddingVertical: 10 }}>
    {stage?.status === 'failed' ? <><Text style={styles.label}>{label}</Text><Text accessibilityRole="alert" style={{ color: colors.danger }}>未完成 · {saved === '等待开始' ? '原录音保留' : saved}</Text></>
      : stage?.status === 'complete' ? <><Text style={styles.label}>{label}</Text><Text style={styles.subtitle}>已完成并保存</Text></>
        : stage ? <ProcessingProgress label={stage.detail ? `${label} · ${speakerPhaseLabel(stage.detail)}` : label} percent={stage.percent} unknownLabel={stage.detail?.phase === 'saving' ? '正在保存，确认后才算完成' : stage.detail ? '当前阶段尚无可计量进度' : '正在处理，暂未提供可计量进度'} />
          : <><Text style={styles.label}>{label}</Text><Text style={styles.subtitle}>{saved}</Text></>}
  </View>
}

/** Presentation only; saved text alone is never treated as proof of completed recognition. */
export function RecordingProcessingStatus({ record, progress, working, phase, noteSaved, notesReading, notesReady = true, children }: {
  record: LocalRecording; progress?: GenerationProgress | null; working: boolean; phase: string; noteSaved: boolean; notesReading: boolean; notesReady?: boolean; children?: React.ReactNode
}) {
  const [models, setModels] = useState<CloudModel[]>([])
  useEffect(() => {
    let active = true, request = 0
    const read = () => {
      const run = ++request, epoch = identityEpoch()
      setModels([])
      void loadModels().then(value => {
        if (active && run === request && identityEpoch() === epoch) setModels(value)
      }).catch(() => {})
    }
    read()
    const unsubscribe = subscribeIdentity(read)
    return () => { active = false; request++; unsubscribe() }
  }, [])
  const modelName = (id: string, kind: 'asr' | 'llm') => modelDisplay(models.find(value => value.id === id && value.modelType === kind), kind)
  const analysis = progress ? analysisProgress(progress) : null
  const active = !!progress || working
  const phaseText = progress?.text || phase
  const summaryActive = active && !analysis && (!!record.generation?.summaryOnly || /^(?:正在生成会议纪要|正在核查纪要|复用完整转写与说话人结果)/.test(phaseText))
  const failedBranch = analysis?.transcription.status === 'failed' || analysis?.speaker.status === 'failed'
  const intervals = record.transcriptionCheckpoint?.version === 5 ? record.transcriptionCheckpoint.intervals : []
  const confirmed = intervals.filter(part => Number.isFinite(part.start) && Number.isFinite(part.end) && part.start >= 0 && part.end > part.start && typeof part.text === 'string')
  const cachedAsr = record.transcriptionCheckpoint?.version === 5
    ? confirmed.length ? `已保留 ${confirmed.length} 个已确认转写区间（含无语音区间）` : `尚无已确认的转写结果；原录音${record.speakerCheckpoint ? '和已保存的说话人结果' : ''}保留`
    : record.transcript ? '已有转写资料，完整性将在处理时核验' : '等待开始'
  const cachedSpeakers = record.speakerCheckpoint?.analysis ? `已保留 ${record.speakerCheckpoint.analysis.completedWindows}/${record.speakerCheckpoint.analysis.totalWindows} 窗分析`
    : record.speakerCheckpoint ? '已有分析资料，将核验来源后复用' : '等待开始'
  const displayCopy = (value: string) => sourceRecoveryCopy(value).replace(
    /已完成(?:的)?识别(?:结果)?保留/g,
    confirmed.length ? '已确认的识别结果保留' : record.speakerCheckpoint
      ? '原录音和已保存的说话人结果保留，尚无已确认的转写结果'
      : '原录音保留，尚无已确认的转写结果')
  const unknownOutcome = recordingASRBlocked(record)
  const failureOutcome = unknownOutcome ? '转写结果尚未确认'
    : record.error ? displayCopy(record.error).split(/[，；;\r\n]/)[0].trim() || '本次处理未完成' : ''
  const title = active ? failedBranch ? '部分处理未完成，正在保存另一项结果' : analysis ? '正在分析录音' : summaryActive ? (phaseText.startsWith('正在核查纪要') ? '正在核查纪要' : '正在生成会议纪要') : '正在处理录音'
    : record.error ? failureOutcome : notesReading ? '正在核对纪要状态' : !notesReady ? '纪要状态待核对，原录音可用' : noteSaved ? '纪要已保存' : record.generation ? '处理进度已保存' : '录音已保存，可以生成纪要'
  const measurement = validAsrProgress(progress?.asrProgress) ? progress!.asrProgress! : null
  const savedSeconds = measurement?.confirmedSeconds ?? confirmed.reduce((sum, part) => sum + part.end - part.start, 0)
  const duration = measurement?.duration ?? (record.transcriptionCheckpoint?.version === 5 ? record.transcriptionCheckpoint.duration : undefined)
  const checkpoint = record.transcriptionCheckpoint
  const completeAsr = !unknownOutcome && checkpoint?.version === 5 && checkpoint.model === (record.asrModel || record.generation?.asrModel) &&
    Number.isFinite(checkpoint.duration) && checkpoint.duration > 0 && Number.isFinite(checkpoint.source?.size) && checkpoint.source.size > 0 &&
    Number.isFinite(checkpoint.source?.modifiedMs) && confirmed.length === intervals.length && confirmed.length > 0 &&
    confirmed.every((part, index) => part.start === (index ? confirmed[index - 1].end : 0) &&
      part.end <= checkpoint.duration && Math.abs(part.end * 16000 - Math.round(part.end * 16000)) <= 1e-6) &&
    confirmed.at(-1)!.end === checkpoint.duration
  const savedCoverage = completeAsr ? `完整转写已保存 · ${formatDuration(Math.round(checkpoint.duration))}`
    : Number.isFinite(duration) && duration! > 0 ? `已确认并保存的转写区间：${Math.floor(savedSeconds)}/${Math.ceil(duration!)} 秒` : ''
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.noteTitle}>{title}</Text>
    {!active && record.error && <Text style={styles.subtitle}>{unknownOutcome
      ? '本次识别不能重新发送音频；原录音和已保存进度保留。'
      : '再次处理前，请核对原录音并确认模型。'}</Text>}
    {summaryActive ? <View style={{ gap: 8 }}>
      {!!savedCoverage && <Text style={styles.subtitle}>{savedCoverage}</Text>}
      <Text style={styles.subtitle}>复用已保存的转写与说话人结果，不再分析录音。</Text>
      {!!phaseText && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{phaseText}</Text>}
    </View> : <View style={{ gap: 4 }}>
      <AnalysisRow label={analysis?.transcription.status === 'complete' ? '语音转写' : '提交识别的音频'} stage={analysis?.transcription} saved={cachedAsr} />
      {measurement && analysis?.transcription.status !== 'complete' && <Text style={styles.subtitle}>提交识别的音频 {Math.floor(measurement.submittedSeconds)}/{Math.ceil(measurement.duration)} 秒（按服务回报）；最终转写待确认</Text>}
      {!!savedCoverage && <Text style={styles.subtitle}>{savedCoverage}</Text>}
      <AnalysisRow label="识别说话人" stage={analysis?.speaker} saved={cachedSpeakers} />
    </View>}
    {children}
    {record.generation && <DetailDisclosure title="处理详情">
      <Text style={styles.subtitle}>语音模型：{modelName(record.generation.asrModel, 'asr')}</Text>
      <Text style={styles.subtitle}>总结模型：{modelName(record.generation.llmModel, 'llm')}</Text>
    </DetailDisclosure>}
  </View>
}
