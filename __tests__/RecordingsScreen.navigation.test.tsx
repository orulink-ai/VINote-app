import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { BackHandler, Text } from 'react-native'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { listNotes } from '../src/lib/notes'
import Sound from 'react-native-nitro-sound'

jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: {
  stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn(),
  startPlayer: jest.fn(async () => {}), pausePlayer: jest.fn(async () => {}), resumePlayer: jest.fn(async () => {}), seekToPlayer: jest.fn(async () => {}), addPlayBackListener: jest.fn(), addPlaybackEndListener: jest.fn(),
} }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn() }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: () => null }))
const recording = { id: 'r1', title: '验收录音', uri: 'file:///original.m4a', createdAt: '2026-10-12', duration: 42 }
let view: Renderer.ReactTestRenderer
beforeEach(() => { jest.mocked(listRecordings).mockReset().mockResolvedValue([recording]); jest.mocked(listNotes).mockReset().mockResolvedValue([]) })
afterEach(async () => { if (view) await act(async () => view.unmount()) })
const textContains = (value: string) => view.root.findAllByType(Text).some(node => typeof node.props.children === 'string' && node.props.children.includes(value))
const button = (title: string) => view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)

test('recording player pauses, resumes and seeks without restarting', async () => {
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="r1" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const control = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
  await act(async () => { control('播放原声').props.onPress(); await Promise.resolve() })
  await act(async () => { control('暂停播放录音').props.onPress(); await Promise.resolve() })
  await act(async () => { control('播放原声').props.onPress(); await Promise.resolve() })
  expect(Sound.startPlayer).toHaveBeenCalledTimes(1)
  expect(Sound.pausePlayer).toHaveBeenCalledTimes(1)
  expect(Sound.resumePlayer).toHaveBeenCalledTimes(1)
  await act(async () => { const slider = control('录音播放进度'); slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); await Promise.resolve() })
  expect(Sound.seekToPlayer).toHaveBeenCalledWith(10000)
})

test('an external original detail has no global import and returns to its actual source', async () => {
  const back = jest.fn()
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="r1" backLabel="返回文件库" onBack={back} onOpenNote={jest.fn()} />) })
  expect(view.root.findByType(ScreenHeader).props.backLabel).toBe('返回文件库')
  expect(button('导入音频')).toBeUndefined()
  expect(button('查看全部录音')).toBeUndefined()
  expect(textContains('验收录音')).toBe(true)
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(back).toHaveBeenCalledTimes(1)
})

test('list details return one level first for both header and hardware back', async () => {
  const back = jest.fn(), hardware = jest.spyOn(BackHandler, 'addEventListener')
  await act(async () => { view = Renderer.create(<RecordingsScreen onBack={back} onOpenNote={jest.fn()} />) })
  const open = () => view.root.findAll(node => node.props.accessibilityLabel === '打开原录音验收录音' && typeof node.props.onPress === 'function')[0].props.onPress()
  await act(async () => open())
  expect(view.root.findByType(ScreenHeader).props.backLabel).toBe('返回录音库')
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(back).not.toHaveBeenCalled()
  expect(button('导入音频')).toBeDefined()
  await act(async () => open())
  const handlers = hardware.mock.calls.filter(call => call[0] === 'hardwareBackPress')
  const handler = handlers[handlers.length - 1][1]
  await act(async () => { handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) })
  expect(back).not.toHaveBeenCalled()
  expect(view.root.findByType(ScreenHeader).props.title).toBe('录音库')
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(back).toHaveBeenCalledTimes(1)
  hardware.mockRestore()
})

test('a missing selected original differs from an empty library or a failed read', async () => {
  jest.mocked(listRecordings).mockResolvedValue([])
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="missing" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  expect(textContains('该原录音已不可用')).toBe(true)
  expect(textContains('还没有录音')).toBe(false)
  jest.mocked(listRecordings).mockRejectedValue(new Error('device unavailable'))
  await act(async () => view.root.findByType(require('react-native').FlatList).props.onRefresh())
  expect(textContains('录音读取未完成')).toBe(true)
  expect(textContains('该原录音已不可用')).toBe(false)
})

test('a notes outage does not hide retained originals and retry restores their status', async () => {
  jest.mocked(listNotes).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="r1" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  expect(textContains('验收录音')).toBe(true)
  expect(textContains('纪要状态暂未读取')).toBe(true)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '播放原声' && typeof node.props.onPress === 'function').length).toBeGreaterThan(0)
  expect(button('导出原音频')).toBeUndefined()
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '录音管理' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(view.root.findAll(node => node.props.accessibilityLabel === '播放原声' && typeof node.props.onPress === 'function').length).toBeGreaterThan(0)
  expect(button('导出原音频')).toBeDefined()
  await act(async () => button('重新加载录音')!.props.onPress())
  expect(textContains('纪要状态暂未读取')).toBe(false)
  expect(textContains('验收录音')).toBe(true)
})
test('a slow notes lookup does not delay original playback or claim no minutes exist', async () => {
  let finish!: (notes: never[]) => void
  jest.mocked(listNotes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view = Renderer.create(<RecordingsScreen initialFocusId="r1" onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  expect(textContains('验收录音')).toBe(true)
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '录音管理' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(view.root.findAll(node => node.props.accessibilityLabel === '播放原声' && typeof node.props.onPress === 'function')[0].props.disabled).toBe(false)
  expect(button('导出原音频')!.props.disabled).toBe(false)
  expect(button('正在核对纪要…')!.props.disabled).toBe(true)
  await act(async () => { finish([]) })
  expect(button('生成会议纪要')!.props.disabled).toBe(false)
})
