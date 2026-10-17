import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { RecordingProcessingStatus } from '../src/components/RecordingProcessingStatus'
import { ProcessingProgress } from '../src/components/ProcessingProgress'
import { Text } from '../src/components/AppText'
import type { AsrProgress } from '../src/lib/asrProgress'
import type { SpeakerProgress } from '../src/lib/speakerProgress'
import type { LocalRecording } from '../src/features/recording/recordingLibrary'
import { loadModels } from '../src/lib/models'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(async () => []) }))
const catalog = jest.mocked(loadModels)

const record: LocalRecording = { id: 'original', uri: 'file:///original.m4a', title: '会议', createdAt: '', duration: 4680,
  generation: { status: 'pending', startedAt: '', asrModel: 'original-asr', llmModel: 'original-llm', version: 1 } }
let view: Renderer.ReactTestRenderer
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
async function openDetails() {
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '处理详情' && typeof node.props.onPress === 'function')[0].props.onPress())
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue([]) })

test('complete sample displays rounded recording length without a false one-second gap', async () => {
  const duration = 1376.5485625
  await mount(undefined, { ...record, duration: 1377,
    transcriptionCheckpoint: { version: 5, model: 'original-asr', duration, source: { size: 1, modifiedMs: 0 }, intervals: [{ start: 0, end: duration, text: 'full' }] } })
  expect(text()).toContain('完整转写已保存 · 22:57')
  expect(text()).not.toContain('1376/1377')
})

test.each(['gap', 'overlap', 'unknown', 'model'])('does not label %s evidence as complete', async damage => {
  const checkpoint = { version: 5 as const, model: damage === 'model' ? 'other' : 'original-asr', duration: 20, source: { size: 1, modifiedMs: 0 },
    intervals: [{ start: damage === 'gap' ? 1 : 0, end: 20, text: 'saved' }], ...(damage === 'unknown' ? { inFlight: { start: 0, end: 20 } } : {}) }
  if (damage === 'overlap') checkpoint.intervals.push({ start: 1, end: 2, text: 'overlap' })
  await mount(undefined, { ...record, transcriptionCheckpoint: checkpoint })
  expect(text()).not.toContain('完整转写已保存')
})

test.each(['正在生成会议纪要 · 已接收 1730 字…', '正在核查纪要 · 已接收 2289 字…'])('summary stage hides obsolete analysis rows and retains real character progress: %s', async phase => {
  await mount({ text: phase })
  expect(text()).toContain(phase)
  expect(text()).not.toContain('提交识别的音频'); expect(text()).not.toContain('识别说话人')
  expect(text()).not.toContain('正在处理录音')
  expect(view.root.findAllByType(ProcessingProgress)).toHaveLength(0)
})

test('phase-only audit is used when module progress is absent', async () => {
  await act(async () => { view = Renderer.create(<RecordingProcessingStatus record={record} working phase="正在核查纪要 · 已接收 2289 字…" noteSaved={false} notesReading={false} />) })
  expect(text()).toContain('正在核查纪要 · 已接收 2289 字…')
  expect(text()).not.toContain('正在处理录音'); expect(text()).not.toContain('识别说话人')
})
async function mount(progress?: { text: string; asrProgress?: AsrProgress; transcriptionPercent?: number; speakerPercent?: number; speakerStage?: SpeakerProgress }, value = record) {
  await act(async () => { view = Renderer.create(<RecordingProcessingStatus key={value.id} record={value} progress={progress && { owner: 'owner', recordId: value.id, ...progress }} working={!!progress} phase="" noteSaved={false} notesReading={false} />) })
}
afterEach(async () => { if (view) await act(async () => view.unmount()) })

test('submission percentage and durable final seconds display independently', async () => {
  await mount({ text: '转写：提交识别的音频\n说话人：本机分析 42%', asrProgress: { duration: 100, submittedSeconds: 100, confirmedSeconds: 0 } })
  const rows = view.root.findAllByType(ProcessingProgress)
  expect(rows[0].props.label).toBe('提交识别的音频'); expect(rows[0].props.percent).toBe(99)
  expect(rows[1].props.percent).toBe(42)
  expect(text().replace(/\s/g, '')).toContain('已确认并保存的转写区间：0/100秒')
  expect(text()).toContain('最终转写待确认'); expect(text()).not.toContain('已完成并保存')
})

test('unstarted recording branches stay waiting and never claim completion', async () => {
  await mount()
  expect(text()).toContain('提交识别的音频'); expect(text()).toContain('识别说话人')
  expect(text().match(/等待开始/g)).toHaveLength(2)
  expect(text()).not.toContain('已完成'); expect(text()).not.toContain('100%')
  expect(view.root.findAllByType(ProcessingProgress)).toHaveLength(0)
})
test('two independent tasks preserve measured speaker progress and leave unknown ASR indeterminate', async () => {
  await mount({ text: '转写：正在等待服务\n说话人：本机分析 42%', speakerPercent: 42 })
  const rows = view.root.findAllByType(ProcessingProgress)
  expect(rows.map(row => row.props.label)).toEqual(['提交识别的音频', '识别说话人'])
  expect(rows[0].props.percent).toBeUndefined(); expect(rows[1].props.percent).toBe(42)
  expect(text()).toContain('暂未提供可计量进度')
  expect(text()).not.toContain('original-asr')
  expect(text()).not.toContain('正在等待服务')
})
test('one failed task does not hide the other task or invent its completion', async () => {
  await mount({ text: '转写：失败，等待保存\n说话人：正在分析', speakerPercent: undefined })
  expect(text()).toContain('部分处理未完成')
  expect(text()).toContain('提交识别的音频'); expect(text()).toContain('识别说话人')
  expect(view.root.findAllByType(ProcessingProgress)).toHaveLength(1)
  expect(text()).not.toContain('100%')
})
test('confirmed saved branches show completion without busy indicators', async () => {
  await mount({ text: '转写：已保存\n说话人：已保存' })
  expect(view.root.findAllByType(ProcessingProgress)).toHaveLength(0)
  expect(text()).toContain('已完成并保存')
})
test('unknown model names use product fallbacks without exposing or changing frozen IDs', async () => {
  await mount(undefined, { ...record, error: '原任务失败' })
  const toggle = () => view.root.findAll(node => node.props.accessibilityLabel === '处理详情' && typeof node.props.onPress === 'function')[0]
  expect(toggle().props.accessibilityState.expanded).toBe(false)
  await act(async () => toggle().props.onPress())
  expect(text()).toContain('已选语音模型'); expect(text()).toContain('已选总结模型')
  expect(text()).not.toContain('original-asr'); expect(text()).not.toContain('original-llm')
  expect(record.uri).toBe('file:///original.m4a'); expect(record.generation?.asrModel).toBe('original-asr')
  await act(async () => view.update(<RecordingProcessingStatus key="other" record={{ ...record, id: 'other' }} working={false} phase="" noteSaved={false} notesReading={false} />))
  expect(toggle().props.accessibilityState.expanded).toBe(false)
  expect(text()).not.toContain('original-asr')
})

test('catalog names require exact frozen ID and model kind', async () => {
  const models = [
    { id: 'original-asr', modelType: 'asr' as const, name: '已核验语音名称' },
    { id: 'original-llm', modelType: 'asr' as const, name: '错误类型名称' },
    { id: 'another-llm', modelType: 'llm' as const, name: '其他模型名称' },
  ]
  catalog.mockResolvedValue(models.map(model => ({ ...model, runtimeStatus: 'available' })))
  await mount(); await openDetails()
  expect(text()).toContain('已核验语音名称')
  expect(text()).toContain('已选总结模型')
  expect(text()).not.toContain('错误类型名称'); expect(text()).not.toContain('其他模型名称')
  expect(record.generation?.llmModel).toBe('original-llm')
})

test('model response from an earlier A session cannot update details after A-B-A', async () => {
  let resolve!: (models: Awaited<ReturnType<typeof loadModels>>) => void
  catalog.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await mount(); await openDetails()
  await act(async () => { transitionIdentity('B'); transitionIdentity('A') })
  await act(async () => resolve([{ id: 'original-asr', modelType: 'asr', runtimeStatus: 'available', ...{ name: '过期账号名称' } }]))
  expect(text()).toContain('已选语音模型'); expect(text()).not.toContain('过期账号名称')
})

test('failed recognition with zero confirmed intervals retains original and speaker evidence without claiming text completion', async () => {
  await mount(undefined, { ...record, error: '转写连接中断，已完成识别保留',
    transcriptionCheckpoint: { version: 5, model: 'original-asr', duration: 4680, source: { size: 1, modifiedMs: 0 }, intervals: [] },
    speakerCheckpoint: { version: 1, provider: 'sherpa-onnx-1.12.35', duration: 4680, source: { size: 1, modifiedMs: 0 }, turns: [],
      analysis: { version: 2, windowSeconds: 120, completedWindows: 40, totalWindows: 40 } },
  })
  await openDetails()
  expect(text()).toContain('原录音和已保存的说话人结果保留')
  expect(text()).toContain('尚无已确认的转写结果')
  expect(text()).toContain('40/40')
  expect(text()).not.toContain('已完成识别保留'); expect(text()).not.toContain('已保留 0 段')
})

test('partial confirmed text is retained without claiming entire recording completion', async () => {
  await mount(undefined, { ...record, error: '转写连接中断，已完成识别保留',
    transcriptionCheckpoint: { version: 5, model: 'original-asr', duration: 4680, source: { size: 1, modifiedMs: 0 }, intervals: [{ start: 0, end: 12, text: '确认的内容' }] },
  })
  await openDetails()
  expect(text()).toContain('已保留 1 个已确认转写区间')
  expect(text()).not.toContain('已完成识别保留'); expect(text()).not.toContain('已完成并保存')
})
test('legacy transcript is retained evidence and never a fabricated completion percentage', async () => {
  await mount(undefined, { ...record, transcript: '旧文字' })
  expect(text()).toContain('完整性将在处理时核验')
  expect(text()).not.toContain('100%')
})

it('labels local window and feature batch percentages and keeps final saving indeterminate', async () => {
  await mount({ text: '转写：等待服务\n说话人：检测', speakerStage: { phase: 'detection', attempt: 'one', percent: 100, unit: { index: 40, total: 40 } } })
  expect(view.root.findAllByType(ProcessingProgress)[1].props.label).toBe('识别说话人 · 检测发言区间 · 第 40/40 窗')
  expect(text()).not.toContain('已完成并保存')
  await act(async () => view.unmount())
  await mount({ text: '转写：等待服务\n说话人：核对', speakerStage: { phase: 'features', attempt: 'one', percent: 74, unit: { index: 2 } } })
  expect(view.root.findAllByType(ProcessingProgress)[1].props.label).toBe('识别说话人 · 核对声音特征 · 第 2 批')
  expect(view.root.findAllByType(ProcessingProgress)[1].props.percent).toBe(74)
  await act(async () => view.unmount())
  await mount({ text: '转写：等待服务\n说话人：正在保存', speakerStage: { phase: 'saving', attempt: 'one' } })
  expect(view.root.findAllByType(ProcessingProgress)[1].props.percent).toBeUndefined()
  expect(text()).toContain('确认后才算完成')
})

test('failed 22-minute detail has one outcome/action and does not duplicate saved branch evidence when expanded', async () => {
  const failed: LocalRecording = { ...record, duration: 1377, error: '转写连接中断，已完成识别保留',
    transcriptionCheckpoint: { version: 5, model: 'original-asr', duration: 1377, source: { size: 1, modifiedMs: 0 }, intervals: [] },
    speakerCheckpoint: { version: 1, provider: 'sherpa-onnx-1.12.35', duration: 1377, source: { size: 1, modifiedMs: 0 }, turns: [],
      analysis: { version: 2, windowSeconds: 120, completedWindows: 12, totalWindows: 12 } },
  }
  const before = JSON.stringify(failed)
  await mount(undefined, failed)
  expect(text()).toContain('转写连接中断')
  expect(text()).toContain('再次处理前，请核对原录音并确认模型。')
  const collapsed = text()
  await openDetails()
  expect(text().match(/转写连接中断/g)).toHaveLength(1)
  expect(text().match(/尚无已确认的转写结果/g)).toHaveLength(1)
  expect(text().match(/12\/12/g)).toHaveLength(1)
  expect(text().match(/已确认并保存的转写区间/g)).toHaveLength(1)
  expect(text()).not.toContain('两项结果分别保存')
  expect(text()).not.toContain('可从已保存进度重试')
  expect(text()).not.toContain('已完成识别保留')
  expect(text()).not.toContain('已完成并保存')
  expect(text()).toContain('已选语音模型'); expect(text()).toContain('已选总结模型')
  expect(collapsed).not.toContain('已选语音模型')
  expect(JSON.stringify(failed)).toBe(before)
})

test('unknown outcome remains unconfirmed and expanding details cannot imply automatic retry or completion', async () => {
  await mount(undefined, { ...record, error: '转写结果尚未确认，未自动重新发送音频；原录音与已保存转写保留', errorDetails: { code: 'unknown_result' } })
  await openDetails()
  expect(text().match(/转写结果尚未确认/g)).toHaveLength(1)
  expect(text()).toContain('本次识别不能重新发送音频；原录音和已保存进度保留。')
  expect(text()).not.toContain('可从已保存进度重试')
  expect(text()).not.toContain('已完成并保存')
})

test('expanding while active does not repeat phase prose or invent durable coverage', async () => {
  await mount({ text: '转写：正在等待服务\n说话人：本机分析 42%', speakerPercent: 42,
    asrProgress: { duration: 1377, submittedSeconds: 1377, confirmedSeconds: 0 } })
  await openDetails()
  expect(text()).not.toContain('正在等待服务')
  expect(text().match(/最终转写待确认/g)).toHaveLength(1)
  expect(text().match(/已确认并保存的转写区间/g)).toHaveLength(1)
  expect(view.root.findAllByType(ProcessingProgress)[0].props.percent).toBe(99)
  expect(view.root.findAllByType(ProcessingProgress)[1].props.percent).toBe(42)
  expect(text()).not.toContain('已完成并保存')
})

test.each(['unknown_error', 'empty_result_unverified', 'asr_empty_result', 'asr_incomplete_result'])('%s remains unconfirmed rather than promising cached retry or no-speech success', async code => {
  await mount(undefined, { ...record, error: '识别服务未完成转写，请核对当前模型与已保存进度', errorDetails: { code } })
  expect(text()).toContain('转写结果尚未确认')
  expect(text()).toContain('不能重新发送音频')
  expect(text()).not.toContain('没有语音'); expect(text()).not.toContain('已完成并保存')
})

test('recording without a generation snapshot has no empty processing-details disclosure', async () => {
  await mount(undefined, { ...record, generation: undefined, error: '原文件暂不可用，请检查文件库' })
  expect(text()).toContain('原文件暂不可用')
  expect(view.root.findAll(node => node.props.accessibilityLabel === '处理详情')).toHaveLength(0)
  expect(text()).not.toContain('两项结果分别保存')
})
