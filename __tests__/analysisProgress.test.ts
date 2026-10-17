import { analysisProgress } from '../src/features/recording/analysisProgress'

test('shows streamed recognition progress while final transcript remains unconfirmed', () => {
  const result = analysisProgress({ owner: 'a', recordId: 'r', asrProgress: { duration: 78, submittedSeconds: 41, confirmedSeconds: 0 }, text: '转写：转写进度 52% · 识别服务已处理 40/78 秒 · 等待最终结果\n说话人：已保存' })
  expect(result).toEqual({ transcription: { status: 'running', percent: 52 }, speaker: { status: 'complete', percent: 100 } })
})

test('recovers measured analysis progress from an in-flight task after a JS reload', () => {
  const result = analysisProgress({ owner: 'a', recordId: 'r', text: '转写：转写已保存 2/10 段 · 120/600 秒 · 20%\n说话人：本机分析 15%' })
  expect(result).toEqual({ transcription: { status: 'preparing', percent: undefined }, speaker: { status: 'running', percent: 15 } })
})

test('a failed branch cannot continue presenting a moving progress bar', () => {
  const result = analysisProgress({ owner: 'a', recordId: 'r', text: '转写：失败，已完成分段保留；等待另一路保存\n说话人：本机分析 15%', transcriptionPercent: 20 })
  expect(result?.transcription).toEqual({ status: 'failed' })
  expect(result?.speaker).toEqual({ status: 'running', percent: 15 })
})

test('summary phase no longer presents obsolete analysis bars', () => {
  expect(analysisProgress({ owner: 'a', recordId: 'r', text: '转写与说话人分析已保存，正在生成会议纪要…' })).toBeNull()
})

import type { SpeakerProgress } from '../src/lib/speakerProgress'
const speaker = (detail: SpeakerProgress, text = '正在处理') => analysisProgress({ owner: 'a', recordId: 'r', text: `转写：等待服务\n说话人：${text}`, speakerPercent: 100, speakerStage: detail })!.speaker
it('keeps detection 100%, feature batch 100%, next batch 74% scoped to different units without pretending completion', () => {
  const first = speaker({ phase: 'detection', attempt: 'a', percent: 100, unit: { index: 40, total: 40 } })
  const next = speaker({ phase: 'features', attempt: 'a', percent: 100, unit: { index: 1 } })
  const last = speaker({ phase: 'features', attempt: 'a', percent: 74, unit: { index: 2 } })
  expect([first.status, next.status, last.status]).toEqual(['running', 'running', 'running'])
  expect(last.percent).toBe(74); expect(last.detail?.unit?.index).toBe(2)
})
it('clears stale percentages in saving, new attempts, and failure; only confirmed saving completes', () => {
  expect(speaker({ phase: 'saving', attempt: 'a' }).percent).toBeUndefined()
  expect(speaker({ phase: 'preparing', attempt: 'b' }).percent).toBeUndefined()
  expect(speaker({ phase: 'features', attempt: 'b', percent: 3 }).percent).toBe(3)
  expect(speaker({ phase: 'features', attempt: 'b', percent: 99 }, '失败')).toEqual({ status: 'failed' })
  expect(speaker({ phase: 'saved', attempt: 'b' }, '已保存').status).toBe('complete')
  expect(analysisProgress({ owner: 'a', recordId: 'r', text: '转写：等待\n说话人：正在准备', speakerPercent: 100 })?.speaker.percent).toBeUndefined()
})
