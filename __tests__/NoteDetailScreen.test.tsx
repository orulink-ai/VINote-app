import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import { NoteDetailScreen } from '../src/screens/NoteDetailScreen'
import { MeetingMarkdown } from '../src/components/MeetingMarkdown'
import { getNote, deleteNote, shareNoteFile } from '../src/lib/notes'
jest.mock('../src/features/recording/recordingLibrary', () => ({ unlinkRecordingNote: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ getNote: jest.fn(), deleteNote: jest.fn(), shareNoteFile: jest.fn() }))
test('renders markdown and confirmed deletion navigates only after success', async () => {
  jest.mocked(getNote).mockResolvedValue({ id: 'note-a', title: '评审', version: 2, content: '# 决定\n\n**保留录音**\n\n|事项|状态|\n|---|---|\n|测试|通过|', created_at: '2026-09-23', generation_client: 'mobile' } as never)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><NoteDetailScreen id="note-a" onBack={back} /></TamaguiProvider>) })
  expect(view.root.findByType(MeetingMarkdown)).toBeTruthy()
  expect(view.root.findAll(node => Array.isArray(node.props.children) && node.props.children[0] === '版本 ' && node.props.children[1] === 2).length).toBeGreaterThan(0)
  const share = view.root.findAll(node => node.props.accessibilityLabel === '分享纪要文件' && typeof node.props.onPress === 'function')[0]
  await act(async () => { await share.props.onPress() })
  expect(shareNoteFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-a', version: 2 }))
  const remove = view.root.findAll(node => node.props.accessibilityLabel === '删除纪要' && typeof node.props.onPress === 'function')[0]
  await act(async () => { remove.props.onPress() })
  expect(deleteNote).not.toHaveBeenCalled()
  jest.mocked(deleteNote).mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(back).not.toHaveBeenCalled()
  await act(async () => { remove.props.onPress() })
  jest.mocked(deleteNote).mockResolvedValueOnce(undefined)
  await act(async () => { await alert.mock.calls.at(-1)![2]![1].onPress!() })
  expect(back).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})
