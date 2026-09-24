import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import { RecordScreen } from '../src/screens/RecordScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import * as recording from '../src/features/recording/recordingService'
import { finalizeRecording } from '../src/features/recording/recordingLibrary'
import { generateRecording } from '../src/features/recording/generateRecording'
jest.mock('../src/features/recording/recordingService', () => ({ startRecording: jest.fn(), stopRecording: jest.fn(async () => 'file:///documents/recordings/test-1.m4a'), listenRecording: jest.fn(() => () => {}) }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ saveRecording: jest.fn(async value => value), finalizeRecording: jest.fn(async value => value), createRecordingDraft: jest.fn(async () => ({ id: 'test-1', uri: 'file:///documents/recordings/test-1.m4a', title: 'Â¼Òô', createdAt: new Date().toISOString(), duration: 0 })) }))
jest.mock('../src/features/recording/generateRecording', () => ({ generateRecording: jest.fn() }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: () => null }))
test('audio-only saves original before navigation and never calls cloud', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const done = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><RecordScreen onDone={done} onBack={jest.fn()} /></TamaguiProvider>) })
  await act(async () => { await view.root.findAllByType(PrimaryButton)[0].props.onPress() })
  await act(async () => { view.root.findAllByType(PrimaryButton)[0].props.onPress() })
  expect(recording.stopRecording).not.toHaveBeenCalled()
  await act(async () => { await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(finalizeRecording).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-1', uri: 'file:///documents/recordings/test-1.m4a' }))
  expect(generateRecording).not.toHaveBeenCalled()
  expect(done).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})
