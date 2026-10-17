import React from 'react'
jest.mock('react-native-nitro-sound', () => ({ stopPlayer: jest.fn().mockResolvedValue(undefined), startPlayer: jest.fn(), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn() }))
import Renderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { NoteDetailScreen } from '../src/screens/NoteDetailScreen'
import { MeetingMarkdown } from '../src/components/MeetingMarkdown'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { Field } from '../src/components/Field'
import { RenameDialog } from '../src/components/RenameDialog'
import { getNote, deleteNote, renameNote, shareNoteFile, exportNoteFile } from '../src/lib/notes'
import { readWorkspace, setWorkspaceDeleted } from '../src/lib/workspace'
jest.mock('../src/features/recording/recordingLibrary', () => ({ unlinkRecordingNote: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ getNote: jest.fn(), deleteNote: jest.fn(), renameNote: jest.fn(), shareNoteFile: jest.fn(async () => {}), exportNoteFile: jest.fn(async () => {}) }))
jest.mock('../src/lib/workspace', () => ({ readWorkspace: jest.fn(), setWorkspaceDeleted: jest.fn(), subscribeWorkspace: jest.fn(() => () => {}) }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(readWorkspace).mockResolvedValue({ mappings: { local: { key: 'shared-a', localIds: ['note-a'] } }, cache: { 'shared-a': { deleted: false } } } as never)
})
test.each(['meeting_recording', 'text'])('visible edit/delete/export/share actions work for %s without a mapping', async source_type => {
  jest.mocked(getNote).mockResolvedValue({ id: 'note-a', title: 'Saved', source_type, content: '# Saved', created_at: '2026-10-12', updated_at: '2026-10-12', status: 'done' } as never)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteDetailScreen id="note-a" onBack={back} />) })
  const action = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
  expect(action(source_type === 'text' ? '编辑笔记' : '编辑纪要')).toBeTruthy()
  await act(async () => action('导出').props.onPress())
  await act(async () => action('分享').props.onPress())
  expect(exportNoteFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-a', content: '# Saved' }))
  expect(shareNoteFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-a', content: '# Saved' }))
  await act(async () => action('删除').props.onPress())
  expect(deleteNote).not.toHaveBeenCalled()
  expect(alert.mock.calls[alert.mock.calls.length - 1][1]).toContain('回收站')
  await act(async () => alert.mock.calls[alert.mock.calls.length - 1][2]![0].onPress?.())
  expect(deleteNote).not.toHaveBeenCalled()
  await act(async () => action('删除').props.onPress())
  jest.mocked(deleteNote).mockRejectedValueOnce(new Error('disk full'))
  await act(async () => alert.mock.calls[alert.mock.calls.length - 1][2]![1].onPress?.())
  expect(back).not.toHaveBeenCalled()
  await act(async () => action('删除').props.onPress())
  jest.mocked(deleteNote).mockResolvedValueOnce(undefined)
  await act(async () => alert.mock.calls[alert.mock.calls.length - 1][2]![1].onPress?.())
  expect(back).toHaveBeenCalledTimes(1)
  expect(setWorkspaceDeleted).not.toHaveBeenCalled(); expect(readWorkspace).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('renames inside the same sheet and retains the draft after a failed save', async () => {
  const note = { id: 'note-a', title: '旧名称', version: 1, content: '# 纪要', created_at: '2026-09-23' }
  jest.mocked(getNote).mockResolvedValue(note as never)
  jest.mocked(renameNote).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...note, title: '新名称' } as never)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteDetailScreen id="note-a" onBack={jest.fn()} />) })
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '内容操作' && typeof node.props.onPress === 'function')[0].props.onPress())
  await act(async () => view.root.findAll(node => node.props.title === '修改名称' && typeof node.props.onPress === 'function')[0].props.onPress())
  const sheet = () => view.root.findAllByType(BottomActionSheet).find(node => node.props.title === '修改名称')!
  expect(sheet().props.visible).toBe(true)
  expect(view.root.findAllByType(RenameDialog)).toHaveLength(0)
  await act(async () => view.root.findByType(Field).props.onChangeText(' 新名称 '))
  await act(async () => view.root.findAll(node => node.props.title === '保存名称' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(sheet().props.visible).toBe(true)
  expect(view.root.findByType(Field).props.value).toBe(' 新名称 ')
  expect(view.root.findAll(node => node.props.accessibilityRole === 'alert' && node.props.children === 'offline').length).toBeGreaterThan(0)
  await act(async () => view.root.findAll(node => node.props.title === '保存名称' && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(renameNote).toHaveBeenLastCalledWith('note-a', '新名称')
  expect(view.root.findAllByType(Field)).toHaveLength(0)
  expect(view.root.findAll(node => node.props.children === '新名称').length).toBeGreaterThan(0)
  await act(async () => view.unmount())
})


test('missing or mismatched saved content never mounts a delivery return target', async () => {
  const { MeetingDetailWorkspace } = require('../src/components/MeetingDetailWorkspace')
  const request = { noteId: 'saved', noteKey: 'saved', owner: 'owner', epoch: 0, operationId: 'op' }
  const consumed = jest.fn()
  jest.mocked(getNote).mockRejectedValueOnce(Error('已移入回收站'))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<NoteDetailScreen id="saved" onBack={jest.fn()} deliveryReturn={request} onDeliveryReturnConsumed={consumed} />) })
  expect(view.root.findAllByType(MeetingDetailWorkspace)).toHaveLength(0)
  expect(consumed).not.toHaveBeenCalled()
  await act(async () => view.unmount())
  jest.mocked(getNote).mockResolvedValueOnce({ id: 'other', title: '错误内容', content: '不同正文' } as never)
  await act(async () => { view = Renderer.create(<NoteDetailScreen id="saved" onBack={jest.fn()} deliveryReturn={request} />) })
  expect(view.root.findAllByType(MeetingDetailWorkspace)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('内容身份未确认')
  await act(async () => view.unmount())
})
