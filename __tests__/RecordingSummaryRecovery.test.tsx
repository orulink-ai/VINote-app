import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { RecordingSummaryRecovery } from '../src/components/RecordingSummaryRecovery'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { CloudModelPicker } from '../src/components/CloudModelPicker'
import { prepareRecordingSummary } from '../src/features/recording/recordingSummaryRecovery'
import { generateRecording, generateRecordingSummary } from '../src/features/recording/generateRecording'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { loadModels, saveSelection } from '../src/lib/models'
import { identityEpoch } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: { stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn() } }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))
jest.mock('../src/features/recording/generateRecording', () => ({ generateRecording: jest.fn(), generateRecordingSummary: jest.fn(async () => 'new-note') }))
jest.mock('../src/features/recording/useRecordingProgress', () => ({ useRecordingProgress: jest.fn(() => null) }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: () => null }))
jest.mock('../src/features/recording/recordingSummaryRecovery', () => ({ prepareRecordingSummary: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(), saveSelection: jest.fn() }))

const record = { id: 'sample', title: '完整旧录音', uri: 'file:///sample.m4a', createdAt: '', duration: 1377,
  transcriptionCheckpoint: { version: 5, model: 'aliyun', duration: 1376.5485625, source: { size: 1, modifiedMs: 1 }, intervals: [{ start: 0, end: 1376.5485625, text: 'final' }] },
  speakerCheckpoint: { version: 1, provider: 'sherpa-onnx-1.12.35', source: { size: 1, modifiedMs: 1 }, duration: 1376.5485625, turns: [], clusteringVersion: 2 } } as const
let view: Renderer.ReactTestRenderer
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(listRecordings).mockResolvedValue([record as never])
  jest.mocked(prepareRecordingSummary).mockResolvedValue({ owner: 'owner', epoch: identityEpoch(), recordId: record.id, evidenceKey: 'verified', record: record as never, transcript: 'full' })
  jest.mocked(loadModels).mockResolvedValue([
    { id: 'aliyun', modelType: 'asr', name: '语音模型', runtimeStatus: 'available' },
    { id: 'deepseek', modelType: 'llm', name: 'Deepseek', runtimeStatus: 'available' },
    { id: 'old', modelType: 'llm', name: '旧模型', availability: { status: 'permission_denied' } } as never,
  ])
})
afterEach(async () => { if (view) await act(async () => view.unmount()) })
const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!

test('existing sheet opens one LLM-only step, supports return/cancel, and submits only after explicit Deepseek choice', async () => {
  await act(async () => { view = Renderer.create(<RecordingsScreen initialGenerateId="sample" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  expect(generateRecordingSummary).not.toHaveBeenCalled()
  const controls = view.root.findAll(node => node.type === PrimaryButton || node.type === CloudModelPicker)
  const summaryButtons = controls.filter(node => node.type === PrimaryButton && node.props.title === '仅生成纪要')
  expect(summaryButtons).toHaveLength(1)
  expect(controls.indexOf(summaryButtons[0])).toBeLessThan(controls.findIndex(node => node.type === CloudModelPicker))
  await act(async () => button('仅生成纪要').props.onPress())
  expect(view.root.findByType(BottomActionSheet).props.onBack).toBeInstanceOf(Function)
  expect(button('确认模型，仅生成纪要').props.disabled).toBe(true)
  const radios = view.root.findAll(node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function')
  expect(radios).toHaveLength(2)
  expect(radios.every(node => node.props.style.minHeight >= 44)).toBe(true)
  expect(radios[1].props.disabled).toBe(true)
  await act(async () => view.root.findByType(BottomActionSheet).props.onBack())
  expect(view.root.findAllByType(RecordingSummaryRecovery)).toHaveLength(0)
  await act(async () => button('仅生成纪要').props.onPress())
  await act(async () => view.root.findAll(node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function')[0].props.onPress())
  await act(async () => button('确认模型，仅生成纪要').props.onPress())
  expect(generateRecordingSummary).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, owner: 'owner', recordId: 'sample', llmModel: 'deepseek', evidenceKey: 'verified' }), expect.any(Function))
  expect(generateRecording).not.toHaveBeenCalled(); expect(saveSelection).not.toHaveBeenCalled()
})

test('incomplete evidence never fetches model list or allows confirmation; cancel remains reachable', async () => {
  jest.mocked(prepareRecordingSummary).mockRejectedValue(new Error('empty intervals'))
  await act(async () => { view = Renderer.create(<RecordingSummaryRecovery recordId="bad" disabled={false} onConfirm={jest.fn()} onCancel={jest.fn()} />) })
  expect(loadModels).not.toHaveBeenCalled()
  expect(button('确认模型，仅生成纪要').props.disabled).toBe(true)
  expect(button('取消').props.disabled).toBe(false)
  expect(button('取消').props.style.minHeight).toBeGreaterThanOrEqual(44)
})
