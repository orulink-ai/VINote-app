import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert, BackHandler, Text } from 'react-native'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { listNotes } from '../src/lib/notes'
import { generateRecording } from '../src/features/recording/generateRecording'
import { useRecordingProgress } from '../src/features/recording/useRecordingProgress'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { RecordingProcessingStatus } from '../src/components/RecordingProcessingStatus'
import Sound from 'react-native-nitro-sound'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: { stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn() } }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn() }))
jest.mock('../src/features/recording/generateRecording', () => ({ generateRecording: jest.fn() }))
jest.mock('../src/features/recording/useRecordingProgress', () => ({ useRecordingProgress: jest.fn(() => null) }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: ({ onReady }: { onReady: (ready: boolean) => void }) => { require('react').useEffect(() => { onReady(true) }, [onReady]); return null } }))
beforeEach(() => { jest.clearAllMocks(); jest.mocked(useRecordingProgress).mockReturnValue(null) })

test.each(['success', 'failure'] as const)('deep return unmounts while generation %s does not reload or alert old view', async outcome => {
  const record = { id: 'detach', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42 }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  let resolve!: (id: string) => void, reject!: (error: Error) => void, progress!: (text: string) => void
  jest.mocked(generateRecording).mockImplementationOnce((_, callback) => { progress = callback; return new Promise((yes, no) => { resolve = yes; reject = no }) })
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const back = jest.fn()
  function Harness() {
    const [open, setOpen] = React.useState(true)
    return open ? <RecordingsScreen initialFocusId="detach" initialGenerateId="detach" onBack={() => { back(); setOpen(false) }} onOpenNote={jest.fn()} /> : null
  }
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<Harness />) })
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '生成版本 1')!.props.onPress())
  expect(view.root.findByType(ScreenHeader).props.disabled).toBe(false)
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(back).toHaveBeenCalledTimes(1); expect(view.root.findAllByType(RecordingsScreen)).toHaveLength(0)
  const reads = jest.mocked(listRecordings).mock.calls.length
  await act(async () => { progress('转写已保存'); if (outcome === 'success') resolve('note'); else reject(new Error('失败已保存')) })
  expect(listRecordings).toHaveBeenCalledTimes(reads); expect(listNotes).toHaveBeenCalledTimes(reads)
  expect(alert).not.toHaveBeenCalled(); expect(generateRecording).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount()); alert.mockRestore()
})

test('A-B-A during delayed playback stop cannot start original generation', async () => {
  const record = { id: 'scope', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42 }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  let stop!: () => void
  jest.mocked(Sound.stopPlayer).mockImplementationOnce(() => new Promise<string>(resolve => { stop = () => resolve('stopped') }))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen initialGenerateId="scope" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '生成版本 1')!.props.onPress())
  transitionIdentity('other'); transitionIdentity('owner')
  await act(async () => stop())
  expect(generateRecording).not.toHaveBeenCalled(); expect(listRecordings).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})

test('return before worker startup continues original owner operation and blocks duplicate confirmation', async () => {
  const record = { id: 'startup', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42 }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  let stop!: () => void
  jest.mocked(Sound.stopPlayer).mockImplementationOnce(() => new Promise<string>(resolve => { stop = () => resolve('stopped') }))
  jest.mocked(generateRecording).mockResolvedValueOnce('note')
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="startup" initialGenerateId="startup" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const confirm = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '生成版本 1')!.props.onPress
  await act(async () => { confirm(); confirm() })
  expect(view.root.findByType(ScreenHeader).props.disabled).toBe(false)
  await act(async () => view.unmount())
  await act(async () => stop())
  expect(generateRecording).toHaveBeenCalledTimes(1); expect(listRecordings).toHaveBeenCalledTimes(1)
})

test('hardware deep return with module progress does not submit and confirmation remains blocked', async () => {
  const record = { id: 'reopened', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42 }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  jest.mocked(useRecordingProgress).mockReturnValue({ owner: 'owner', recordId: record.id, text: '正在分析', speakerPercent: 40 })
  const hardware = jest.spyOn(BackHandler, 'addEventListener'), back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="reopened" initialGenerateId="reopened" onBack={back} onOpenNote={jest.fn()} />) })
  const confirm = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '生成版本 1')!
  expect(confirm.props.disabled).toBe(true)
  await act(async () => confirm.props.onPress())
  const handler = hardware.mock.calls.filter(call => call[0] === 'hardwareBackPress').at(-1)![1]
  await act(async () => { handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) })
  expect(back).toHaveBeenCalledTimes(1); expect(generateRecording).not.toHaveBeenCalled()
  await act(async () => view.unmount()); hardware.mockRestore()
})

test('late pending poll and list read do not revive an unmounted page', async () => {
  jest.useFakeTimers()
  const record = { id: 'poll', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42,
    generation: { status: 'pending' as const, version: 1, startedAt: '', asrModel: 'asr', llmModel: 'llm' } }
  let recordings!: (records: typeof record[]) => void, notes!: (values: never[]) => void
  jest.mocked(listRecordings).mockResolvedValueOnce([record]).mockImplementationOnce(() => new Promise(resolve => { recordings = resolve }))
  jest.mocked(listNotes).mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise(resolve => { notes = resolve }))
  let view!: Renderer.ReactTestRenderer
  try {
    await act(async () => { view = Renderer.create(<RecordingsScreen onBack={jest.fn()} onOpenNote={jest.fn()} />) })
    await act(async () => { jest.advanceTimersByTime(5000) })
    await act(async () => view.unmount())
    await act(async () => { recordings([record]); notes([]); jest.advanceTimersByTime(10000) })
    expect(listRecordings).toHaveBeenCalledTimes(2); expect(listNotes).toHaveBeenCalledTimes(2)
    expect(generateRecording).not.toHaveBeenCalled()
  } finally { jest.useRealTimers() }
})

test('in-flight generation permits progress focus and internal return while mutations stay disabled', async () => {
  const record = { id: 'active', title: '进行中录音', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 42 }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  let finish!: (id: string) => void
  jest.mocked(generateRecording).mockImplementationOnce(() => {
    jest.mocked(useRecordingProgress).mockReturnValue({ owner: 'owner', recordId: record.id, text: '转写：正在处理\n说话人：正在分析', transcriptionPercent: 30, speakerPercent: 40 })
    return new Promise(resolve => { finish = resolve })
  })
  const back = jest.fn(), hardware = jest.spyOn(BackHandler, 'addEventListener')
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen onBack={back} onOpenNote={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!
  await act(async () => button('生成会议纪要').props.onPress())
  await act(async () => button('生成版本 1').props.onPress())
  const row = () => view.root.findAll(node => node.props.accessibilityLabel === '打开原录音进行中录音' && typeof node.props.onPress === 'function')[0]
  expect(row().props.disabled).toBe(false)
  await act(async () => row().props.onPress())
  expect(view.root.findByType(RecordingProcessingStatus).props.progress.transcriptionPercent).toBe(30)
  expect(button('正在处理…').props.disabled).toBe(true)
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '来源与录音操作' && typeof node.props.onPress === 'function')[0].props.onPress())
  const deletion = view.root.findAll(node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(child => child.props.children === '删除录音'))
  expect(deletion.some(node => node.props.disabled === true)).toBe(true)
  expect(view.root.findByType(ScreenHeader).props.disabled).toBe(false)
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(view.root.findByType(ScreenHeader).props.title).toBe('录音库'); expect(back).not.toHaveBeenCalled()
  await act(async () => row().props.onPress())
  const handler = hardware.mock.calls.filter(call => call[0] === 'hardwareBackPress').at(-1)![1]
  await act(async () => { handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) })
  expect(view.root.findByType(ScreenHeader).props.title).toBe('录音库'); expect(back).not.toHaveBeenCalled()
  expect(generateRecording).toHaveBeenCalledTimes(1)
  await act(async () => { finish('saved') })
  await act(async () => view.unmount()); hardware.mockRestore()
})

test('an interrupted pending recording offers explicit continuation on the original task', async () => {
  jest.clearAllMocks()
  const record = { id: 'interrupted', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-10', duration: 90,
    generation: { status: 'pending' as const, version: 2, startedAt: '2026-10-10', asrModel: 'asr', llmModel: 'llm' } }
  jest.mocked(listRecordings).mockResolvedValue([record])
  jest.mocked(listNotes).mockResolvedValue([])
  jest.mocked(generateRecording).mockReset().mockResolvedValue('note')
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  expect(button('继续处理').props.disabled).toBe(false)
  expect(generateRecording).not.toHaveBeenCalled()
  await act(async () => button('继续处理').props.onPress())
  expect(view.root.findByType(BottomActionSheet).props.title).toBe('继续处理')
  await act(async () => button('继续生成版本 2').props.onPress())
  expect(generateRecording).toHaveBeenCalledWith(record, expect.any(Function), true)
  await act(async () => view.unmount())
})

test('generation uses a sheet, closes it on start and offers retry after failure', async () => {
  const original = { id: 'r1', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-10', duration: 90 }
  const paused = { ...original, error: '转写暂不可用', generation: { status: 'paused' as const, version: 1, startedAt: '2026-10-10', asrModel: 'asr', llmModel: 'llm' } }
  jest.mocked(listRecordings).mockResolvedValueOnce([original]).mockResolvedValue([paused])
  jest.mocked(listNotes).mockResolvedValue([])
  jest.mocked(generateRecording).mockRejectedValueOnce(new Error('转写暂不可用')).mockResolvedValueOnce({} as never)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => button('生成会议纪要').props.onPress())
  expect(view.root.findByType(BottomActionSheet).props.visible).toBe(true)
  await act(async () => { button('生成版本 1').props.onPress() })
  expect(view.root.findByType(BottomActionSheet).props.visible).toBe(false)
  expect(alert).toHaveBeenCalledWith('操作未完成', '转写暂不可用')
  expect(view.root.findAllByType(Text).some(node => typeof node.props.children === 'string' && node.props.children.includes('转写暂不可用'))).toBe(true)
  await act(async () => button('重试生成纪要').props.onPress())
  expect(view.root.findByType(BottomActionSheet).props.title).toBe('重试生成纪要')
  await act(async () => { button('重试生成版本 1').props.onPress() })
  expect(generateRecording).toHaveBeenCalledTimes(2)
  expect(generateRecording).toHaveBeenLastCalledWith(expect.objectContaining({ uri: original.uri, generation: paused.generation }), expect.any(Function), true)
  await act(async () => view.unmount())
  alert.mockRestore()
})

test('historical unknown disables confirmation and deep entry never starts a replacement attempt', async () => {
  const record = { id: 'historical-unknown', title: '会议', uri: 'file:///original.m4a', createdAt: '2026-10-14', duration: 1377,
    error: 'unknown_result', errorDetails: { code: 'unknown_result' },
    generation: { status: 'paused' as const, asrModel: 'original', llmModel: 'summary', startedAt: '', version: 1 } }
  jest.mocked(listRecordings).mockResolvedValue([record]); jest.mocked(listNotes).mockResolvedValue([])
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen initialGenerateId={record.id} onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const confirm = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '重试生成版本 1')!
  expect(confirm.props.disabled).toBe(true)
  await act(async () => confirm.props.onPress())
  expect(generateRecording).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
