import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { RecordScreen } from '../src/screens/RecordScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import * as recording from '../src/features/recording/recordingService'
import { finalizeRecording } from '../src/features/recording/recordingLibrary'
jest.mock('../src/features/recording/recordingService', () => ({ startRecording: jest.fn(), isRecordingActive: jest.fn(() => false), pauseRecording: jest.fn(async () => {}), resumeRecording: jest.fn(async () => {}), stopRecording: jest.fn(async () => 'file:///documents/recordings/test-1.m4a'), listenRecording: jest.fn(() => () => {}) }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ saveRecording: jest.fn(async value => value), finalizeRecording: jest.fn(async value => value), createRecordingDraft: jest.fn(async () => ({ id: 'test-1', uri: 'file:///documents/recordings/test-1.m4a', title: '¼��', createdAt: new Date().toISOString(), duration: 0 })) }))
beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.restoreAllMocks())
test('recording saves original before offering post-recording choices', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const done = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<><RecordScreen onDone={done} onBack={jest.fn()} /></>) })
  await act(async () => { await view.root.findAllByType(PrimaryButton).find(button => button.props.title === '开始录音')!.props.onPress() })
  await act(async () => { view.root.findAllByType(PrimaryButton).find(button => button.props.title === '结束录音')!.props.onPress() })
  expect(recording.stopRecording).not.toHaveBeenCalled()
  await act(async () => { await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(finalizeRecording).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-1', uri: 'file:///documents/recordings/test-1.m4a' }))
  expect(alert.mock.calls.at(-1)![0]).toBe('录音已保存')
  expect(done).not.toHaveBeenCalled()
  await act(async () => { alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(done).toHaveBeenCalledWith('test-1')
  await act(async () => view.unmount())
})


test('pause excludes the paused interval and stores marks at recording offsets', async () => {
  let now = 10000
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordScreen onDone={jest.fn()} onBack={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('开始录音').props.onPress() })
  now = 20000
  await act(async () => { button('标记').props.onPress(); await button('暂停').props.onPress() })
  expect(recording.pauseRecording).toHaveBeenCalled()
  now = 80000
  await act(async () => { await button('继续录音').props.onPress() })
  expect(recording.resumeRecording).toHaveBeenCalled()
  now = 100000
  await act(async () => { button('结束录音').props.onPress() })
  await act(async () => { await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(finalizeRecording).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 30, bookmarks: [{ seconds: 10, label: '会议标记' }] }))
  await act(async () => view.unmount())
  clock.mockRestore()
  alert.mockRestore()
})

test('save retry reuses the stopped original even from the first failure alert', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  jest.mocked(finalizeRecording).mockRejectedValueOnce(new Error('disk unavailable'))
  const state = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordScreen onDone={jest.fn()} onBack={jest.fn()} onState={state} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('开始录音').props.onPress() })
  await act(async () => { button('结束录音').props.onPress(); await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, unsaved: true, status: 'save-failed' }))
  const retry = alert.mock.calls.at(-1)![2]!.find(item => item.text === '重试保存原录音')!
  await act(async () => { await retry.onPress!() })
  expect(recording.stopRecording).toHaveBeenCalledTimes(1)
  expect(finalizeRecording).toHaveBeenCalledTimes(2)
  expect(jest.mocked(finalizeRecording).mock.calls[1][0]).toBe(jest.mocked(finalizeRecording).mock.calls[0][0])
  expect(alert.mock.calls.at(-1)![0]).toBe('录音已保存')
  await act(async () => view.unmount())
})

test('cancel ending a paused recording does not imply or invoke resume', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordScreen onDone={jest.fn()} onBack={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('开始录音').props.onPress() })
  await act(async () => { await button('暂停').props.onPress() })
  await act(async () => { button('结束录音').props.onPress() })
  expect(alert.mock.calls.at(-1)![2]![0].text).toBe('暂不结束')
  expect(recording.resumeRecording).not.toHaveBeenCalled()
  expect(recording.stopRecording).not.toHaveBeenCalled()
  expect(button('继续录音')).toBeDefined()
  await act(async () => view.unmount())
})

test('cancel preparation waits for the original native request and blocks another start', async () => {
  let finishNative!: () => void
  let signal: AbortSignal | undefined
  jest.mocked(recording.startRecording).mockImplementationOnce(async (_path, currentSignal) => {
    signal = currentSignal
    await new Promise<void>(resolve => { finishNative = resolve })
    if (signal?.aborted) throw new Error('录音准备已取消')
    return ''
  })
  const state = jest.fn()
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordScreen onDone={jest.fn()} onBack={jest.fn()} onState={state} />) })
  const buttons = () => view.root.findAllByType(PrimaryButton)
  let work!: Promise<void>
  await act(async () => { work = buttons().find(item => item.props.title === '开始录音')!.props.onPress() })
  await act(async () => { buttons().find(item => item.props.title === '取消准备')!.props.onPress() })
  expect(signal?.aborted).toBe(true)
  expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, unsaved: true, status: 'cancelling' }))
  expect(buttons().some(item => item.props.title === '开始录音')).toBe(false)
  await act(async () => { finishNative(); await work })
  expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, unsaved: false, status: 'idle' }))
  expect(alert).not.toHaveBeenCalled()
  expect(buttons().find(item => item.props.title === '开始录音')).toBeDefined()
  await act(async () => view.unmount())
})

test('an unconfirmed native stop keeps controls and never offers saved content', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  jest.mocked(recording.stopRecording).mockRejectedValueOnce(new Error('native stop failed'))
  jest.mocked(recording.isRecordingActive).mockReturnValueOnce(true)
  const state = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordScreen onDone={jest.fn()} onBack={jest.fn()} onState={state} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('开始录音').props.onPress() })
  await act(async () => { button('结束录音').props.onPress(); await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(alert.mock.calls.at(-1)![0]).toBe('结束录音未完成')
  expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, status: 'unconfirmed' }))
  expect(finalizeRecording).not.toHaveBeenCalled()
  await act(async () => { button('结束录音').props.onPress(); await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(recording.stopRecording).toHaveBeenCalledTimes(2)
  expect(finalizeRecording).toHaveBeenCalledTimes(1)
  expect(alert.mock.calls.at(-1)![0]).toBe('录音已保存')
  await act(async () => view.unmount())
})
