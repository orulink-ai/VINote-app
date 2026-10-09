import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { importRecording } from '../src/features/recording/recordingLibrary'

jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: {
  stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn(),
} }))
jest.mock('../src/features/recording/recordingLibrary', () => ({
  importRecording: jest.fn(async () => null), listRecordings: jest.fn(async () => []),
}))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))
jest.mock('../src/components/CloudModelPicker', () => ({ CloudModelPicker: () => null }))

test('home import shortcut opens the picker once and tolerates cancellation', async () => {
  let view!: Renderer.ReactTestRenderer
  const props = { initialImport: true, onBack: jest.fn(), onOpenNote: jest.fn() }
  await act(async () => { view = Renderer.create(<RecordingsScreen {...props} />) })
  expect(importRecording).toHaveBeenCalledTimes(1)
  await act(async () => { view.update(<RecordingsScreen {...props} />) })
  expect(importRecording).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})
