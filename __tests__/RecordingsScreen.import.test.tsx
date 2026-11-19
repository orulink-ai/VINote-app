import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'
import { Alert } from 'react-native'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { importRecording, listRecordings } from '../src/features/recording/recordingLibrary'

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

test('successful import opens the saved recording directly with generation available on demand', async () => {
  const imported = { id: 'imported-1', uri: 'file:///original.wav', title: '验收音频', createdAt: '2026-11-17', duration: 7 }
  jest.mocked(importRecording).mockResolvedValueOnce(imported)
  jest.mocked(listRecordings).mockResolvedValue([imported])
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<RecordingsScreen home onBack={jest.fn()} onOpenNote={jest.fn()} />) })
  const action = view.root.findAllByType(PrimaryButton).find(button => button.props.title === '导入音频')!
  await act(async () => action.props.onPress())
  expect(view.root.findByType(ScreenHeader).props.title).toBe('会议详情')
  expect(view.root.findAllByType(PrimaryButton).some(button => button.props.title === '生成会议纪要')).toBe(true)
  expect(alert).not.toHaveBeenCalled()
  await act(async () => view.unmount())
  alert.mockRestore()
})
