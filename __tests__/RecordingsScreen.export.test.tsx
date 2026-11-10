import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { RecordingProcessingStatus } from '../src/components/RecordingProcessingStatus'
import { deleteRecording, exportRecording, listRecordings } from '../src/features/recording/recordingLibrary'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { listNotes } from '../src/lib/notes'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(), exportRecording: jest.fn(), deleteRecording: jest.fn(async () => {}) }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))
jest.mock('../src/features/recording/generateRecording', () => ({ generateRecording: jest.fn(), generateRecordingSummary: jest.fn() }))
jest.mock('../src/features/recording/useRecordingProgress', () => ({ useRecordingProgress: () => null }))
jest.mock('../src/components/RecordingProcessingStatus', () => ({ RecordingProcessingStatus: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: { stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn() } }))

const records = ['r1', 'r2'].map(id => ({ id, title: id, uri: `file:///documents/recordings/accounts/owner/${id}.m4a`, createdAt: '2026-10-20', duration: 42 }))
let view: Renderer.ReactTestRenderer
const button = () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '导出原音频')!
const text = () => view.root.findAll(node => typeof node.type === 'string').flatMap(node => React.Children.toArray(node.props.children).filter(child => typeof child === 'string')).join(' ')
const pressLabel = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress()
async function mount() {
  await act(async () => { view = Renderer.create(<RecordingsScreen onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  await act(async () => { pressLabel('打开原录音r1') })
  await act(async () => { pressLabel('录音管理') })
}
beforeEach(() => { jest.clearAllMocks(); transitionIdentity('owner'); jest.mocked(listRecordings).mockResolvedValue(records) })
afterEach(() => { act(() => view?.unmount()); jest.restoreAllMocks() })

test('meeting home lists recordings first and retains independently accessible unlinked minutes', async () => {
  jest.mocked(listNotes).mockResolvedValueOnce([{ id: 'linked', task_id: 'r1', source_type: 'meeting' }, { id: 'orphan', title: '旧纪要', task_id: 'missing', source_type: 'meeting' }] as never)
  const open = jest.fn()
  await act(async () => { view = Renderer.create(<RecordingsScreen home onBack={jest.fn()} onOpenNote={open} />) })
  expect(view.root.findByType(ScreenHeader).props.title).toBe('会议')
  expect(view.root.findAll(node => node.props.accessibilityLabel === '打开原录音r1')).not.toHaveLength(0)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '打开未关联录音的纪要 旧纪要')).not.toHaveLength(0)
  await act(async () => { pressLabel('打开原录音r1') })
  expect(view.root.findByType(ScreenHeader).props.title).toBe('会议详情')
  expect(view.root.findByProps({ accessibilityLabel: '查看版本 1' })).toBeDefined()
})

test('after deleting a meeting the detail closes and returns to the recording list', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  await mount()
  const label = view.root.find(node => node.props.children === '删除会议及原录音')
  let pressable = label.parent
  while (pressable && typeof pressable.props.onPress !== 'function') pressable = pressable.parent
  await act(async () => { pressable!.props.onPress() })
  const buttons = alert.mock.calls[0][2]!
  jest.mocked(listRecordings).mockResolvedValue([records[1]])
  await act(async () => { buttons.find(button => button.text === '删除')!.onPress!() })
  expect(deleteRecording).toHaveBeenCalledWith(records[0])
  expect(view.root.findByType(ScreenHeader).props.title).toBe('录音库')
})

test.each(['saved', 'cancelled'] as const)('shows actual %s outcome after action finally, clears progress and locks duplicate export', async result => {
  let finish!: (value: 'saved' | 'cancelled') => void
  jest.mocked(exportRecording).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  const press = button().props.onPress
  await act(async () => { press(); press() })
  expect(exportRecording).toHaveBeenCalledTimes(1)
  expect(button().props.disabled).toBe(true)
  expect(view.root.findByType(RecordingProcessingStatus).props.phase).toBe('正在导出…')
  await act(async () => { finish(result) })
  expect(text()).toContain(result === 'saved' ? '原音频已保存到所选位置。' : '已取消导出，原音频保留。')
  expect(text()).not.toContain('正在导出…')
  expect(button().props.disabled).toBe(false)
  expect(view.root.findByType(RecordingProcessingStatus).props.phase).toBe('')
})

test('a real export rejection is reported and does not leave progress or a false saved message', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  jest.mocked(exportRecording).mockRejectedValueOnce(new Error('保存位置不可写'))
  await mount()
  await act(async () => { button().props.onPress() })
  expect(alert).toHaveBeenCalledWith('操作未完成', '保存位置不可写')
  expect(text()).not.toContain('已保存到所选位置')
  expect(view.root.findByType(RecordingProcessingStatus).props.phase).toBe('')
  expect(button().props.disabled).toBe(false)
})

test.each(['saved', 'failed'] as const)('switching recording detail discards the late %s outcome', async result => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let finish!: (value: 'saved') => void, fail!: (error: Error) => void
  jest.mocked(exportRecording).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
  await mount()
  await act(async () => { button().props.onPress() })
  await act(async () => { view.root.findByType(ScreenHeader).props.onBack() })
  await act(async () => { pressLabel('打开原录音r2') })
  await act(async () => { if (result === 'saved') finish('saved'); else fail(new Error('OLD_RECORD_FAILURE')) })
  expect(text()).not.toContain('已保存到所选位置')
  expect(alert).not.toHaveBeenCalled()
})

test.each(['unmount', 'ABA'] as const)('late export cannot update or alert after %s', async change => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let finish!: (value: 'saved') => void
  jest.mocked(exportRecording).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await act(async () => { button().props.onPress() })
  const reads = jest.mocked(listRecordings).mock.calls.length
  if (change === 'unmount') act(() => view.unmount())
  else act(() => { transitionIdentity('other'); transitionIdentity('owner') })
  await act(async () => { finish('saved') })
  expect(listRecordings).toHaveBeenCalledTimes(reads)
  expect(alert).not.toHaveBeenCalled()
  if (change !== 'unmount') expect(text()).not.toContain('已保存到所选位置')
})
