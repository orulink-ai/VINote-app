import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import { RecordScreen } from '../src/screens/RecordScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { listenRecording } from '../src/features/recording/recordingService'

jest.mock('../src/features/recording/recordingService', () => ({
  startRecording: jest.fn(async () => 'file:///documents/recordings/test.m4a'),
  stopRecording: jest.fn(async () => 'file:///documents/recordings/test.m4a'),
  listenRecording: jest.fn(() => () => {}),
}))
jest.mock('../src/features/recording/recordingLibrary', () => ({
  createRecordingDraft: jest.fn(async () => ({ id: 'test', uri: 'file:///documents/recordings/test.m4a', title: '会议', createdAt: '', duration: 0 })),
  saveRecording: jest.fn(async value => value),
  finalizeRecording: jest.fn(async value => value),
}))
jest.mock('../src/features/recording/generateRecording', () => ({ generateRecording: jest.fn() }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: () => null }))

test('a negative native recording position never reaches the timer display', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000)
  let nativeTick: ((milliseconds: number) => void) | undefined
  jest.mocked(listenRecording).mockImplementation(callback => { nativeTick = callback; return () => {} })
  let view: Renderer.ReactTestRenderer | undefined
  try {
    await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><RecordScreen onDone={jest.fn()} onBack={jest.fn()} /></TamaguiProvider>) })
    const timerText = () => view!.root.findAll(node => node.props.fontSize === 48)[0].props.children.join('')
    await act(async () => { await view!.root.findAllByType(PrimaryButton)[0].props.onPress() })
    await act(async () => { nativeTick?.(-235227000) })
    expect(timerText()).toBe('00:00')
    clock.mockReturnValue(4500)
    await act(async () => { nativeTick?.(-235227000) })
    expect(timerText()).toBe('00:03')
  } finally {
    clock.mockRestore()
    if (view) await act(async () => view!.unmount())
  }
})
