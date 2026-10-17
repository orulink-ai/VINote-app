import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FileLibraryScreen } from '../src/screens/FileLibraryScreen'
import { listLocalFileLinks, listLocalFiles, importLocalFile, setLocalFilePurpose, deleteLocalFile } from '../src/lib/localFiles'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { readAccountId } from '../src/lib/storage'
import { noteSourceFiles } from '../src/lib/noteSourceFiles'
import { Alert, FlatList } from 'react-native'
import { createTextNote } from '../src/lib/notes'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/localFiles', () => ({ listLocalFiles: jest.fn(), listLocalFileLinks: jest.fn(), importLocalFile: jest.fn(), setLocalFilePurpose: jest.fn(), exportLocalFile: jest.fn(), deleteLocalFile: jest.fn(), readTextFile: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createTextNote: jest.fn() }))
jest.mock('../src/lib/noteSourceFiles', () => ({ noteSourceFiles: jest.fn() }))
const file = { id: '11111111-1111-4111-8111-111111111111', uri: 'file:///documents/files/accounts/owner/11111111-1111-4111-8111-111111111111.docx', name: 'source.docx', size: 123, category: 'file' as const, purpose: 'note' as const, extension: 'docx', createdAt: '2026-10-12' }
const association = { owner: 'owner', localFileId: file.id, operationId: '22222222-2222-4222-8222-222222222222', generationOrigin: 'http://127.0.0.1:8900', taskId: '33333333-3333-4333-8333-333333333333', noteId: 'source-33333333-3333-4333-8333-333333333333', state: 'saved' as const }
const views: Renderer.ReactTestRenderer[] = []
const hostText = (view: Renderer.ReactTestRenderer) => view.root
  .findAll(node => typeof node.type === 'string')
  .flatMap(node => {
    const children: unknown[] = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
    return children.filter(child => typeof child === 'string' || typeof child === 'number')
  })
  .join(' ')
const press = (view: Renderer.ReactTestRenderer, label: string) => view.root.findAll(node => (node.props?.title === label || node.props?.accessibilityLabel === label) && typeof node.props?.onPress === 'function')[0].props.onPress()
async function mount(onOpenNote = jest.fn()) {
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FileLibraryScreen view={{ purpose: 'note', category: 'all', query: '' }} onRecording={jest.fn()} onOpenNote={onOpenNote} onSummarize={jest.fn()} />) })
  views.push(view); return view
}
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockReset().mockResolvedValue('owner')
  jest.mocked(listLocalFiles).mockResolvedValue([file]); jest.mocked(listRecordings).mockResolvedValue([])
  jest.mocked(listLocalFileLinks).mockReset().mockResolvedValue([{ association, noteId: 'workspace-current-note', noteTitle: '当前正文' }])
  jest.mocked(noteSourceFiles).mockResolvedValue([file])
})
afterEach(() => { act(() => views.splice(0).forEach(view => view.unmount())) })

test('the exact source view ignores library filters and hides unrelated import and generation controls', async () => {
  const note = { id: 'workspace-current-note', title: '验收 Word' } as never, back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FileLibraryScreen sourceNote={note} onBack={back} onRecording={jest.fn()} onOpenNote={jest.fn()} view={{ category: 'video', query: 'unrelated' }} onSummarize={jest.fn()} />) })
  views.push(view)
  expect(noteSourceFiles).toHaveBeenCalledWith(note, 'owner')
  expect(view.root.findAll(node => node.props.title === '导入文件')).toHaveLength(0)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '打开文件 source.docx').length).toBeGreaterThan(0)
  await act(async () => { press(view, '打开文件 source.docx') })
  expect(view.root.findAll(node => node.props.title === '生成总结笔记' || node.props.title === '再生成一份笔记')).toHaveLength(0)
  expect(hostText(view)).toContain('导出文件')
})

test('real original opens its current mapped note after owner-bound readback, without claiming original sync', async () => {
  const open = jest.fn(), view = await mount(open)
  expect(listLocalFiles).toHaveBeenCalledWith('owner')
  await act(async () => { press(view, '打开文件 source.docx') })
  expect(listLocalFileLinks).toHaveBeenCalledWith(file, 'owner')
  expect(hostText(view)).toContain('原始文件独立保留')
  await act(async () => { press(view, '查看关联笔记：当前正文') })
  expect(listLocalFileLinks).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenCalledWith('workspace-current-note')
})

test('unverified old original or unknown submission does not invent a note action', async () => {
  jest.mocked(listLocalFileLinks).mockResolvedValue([{ association: { ...association, state: 'unknown', taskId: undefined, noteId: undefined } }])
  const view = await mount()
  await act(async () => { press(view, '打开文件 source.docx') })
  expect(view.root.findAll(node => typeof node.props?.title === 'string' && node.props.title.startsWith('查看关联笔记：'))).toHaveLength(0)
  expect(hostText(view)).toContain('原提交待核验，不自动重新提交')
})

test('deleted or unavailable note at click readback cannot navigate from a stale association', async () => {
  const open = jest.fn(), view = await mount(open)
  await act(async () => { press(view, '打开文件 source.docx') })
  jest.mocked(listLocalFileLinks).mockResolvedValue([{ association }])
  await act(async () => { press(view, '查看关联笔记：当前正文') })
  expect(open).not.toHaveBeenCalled()
  expect(hostText(view)).toContain('关联笔记当前不可用')
})

test('42-second recording row retains its measured seconds instead of rounded minutes', async () => {
  jest.mocked(listRecordings).mockResolvedValue([{ id: 'record', title: '原录音', duration: 42, createdAt: '2026-10-12', uri: 'file:///owned/record.m4a' }])
  const view = await mount()
  await act(async () => { press(view, '会议资料') })
  expect(hostText(view)).toContain('0:42')
  expect(hostText(view)).not.toContain('1 分钟')
})

test('processing status and linked content remain available without exposing technical identifiers', async () => {
  const view = await mount()
  await act(async () => { press(view, '打开文件 source.docx') })
  expect(hostText(view)).toContain('正文已保存')
  expect(hostText(view)).not.toContain(association.operationId)
  const noteAction = view.root.findAll(node => node.props.title === '查看关联笔记：当前正文')[0]
  expect(noteAction.props.secondary).toBe(false)
  expect(view.root.findAll(node => node.props.title === '再生成一份笔记')[0].props.secondary).toBe(true)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '查看处理详情')).toHaveLength(0)
  expect(hostText(view)).not.toContain(association.operationId)
  expect(hostText(view)).not.toContain(association.taskId)
  expect(view.root.findAll(node => node.props.title === '查看关联笔记：当前正文').length).toBeGreaterThan(0)
})

test('purpose precedes format: note audio and meeting video never cross material groups', async () => {
  jest.mocked(listRecordings).mockResolvedValue([{ id: 'record', title: '会议录音', duration: 42, createdAt: '2026-10-12', uri: 'file:///owned/record.m4a' }])
  jest.mocked(listLocalFiles).mockResolvedValue([
    { ...file, name: '笔记音频.wav', category: 'audio', extension: 'wav' },
    { ...file, id: 'meeting-video', name: '会议视频.mp4', category: 'video', extension: 'mp4', purpose: 'meeting' },
  ])
  const view = await mount()
  expect(hostText(view)).toContain('笔记音频.wav')
  expect(hostText(view)).not.toContain('会议录音')
  expect(hostText(view)).not.toContain('会议视频.mp4')
  await act(async () => { press(view, '会议资料') })
  expect(hostText(view)).toContain('会议录音')
  expect(hostText(view)).toContain('会议视频.mp4')
  expect(hostText(view)).not.toContain('笔记音频.wav')
  await act(async () => { press(view, '视频') })
  expect(hostText(view)).toContain('会议视频.mp4')
  expect(hostText(view)).not.toContain('会议录音')
})

test('format tabs are All/Audio/Video/Document; screen captures and imported video share Video with real source badges', async () => {
  jest.mocked(listLocalFiles).mockResolvedValue([
    { ...file, id: 'capture', name: 'screen.mp4', category: 'video', extension: 'mp4', purpose: 'meeting', source: 'screen_recording' },
    { ...file, id: 'imported', name: 'imported.mp4', category: 'video', extension: 'mp4', purpose: 'meeting', source: 'import' },
  ])
  const view = await mount()
  await act(async () => { press(view, '会议资料'); press(view, '视频') })
  const tabs = view.root.findAll(node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function').map(node => node.props.accessibilityLabel)
  expect(tabs).toEqual(['会议资料', '笔记资料', '全部', '音频', '视频', '文档'])
  expect(hostText(view)).toContain('screen.mp4')
  expect(hostText(view)).toContain('imported.mp4')
  expect(hostText(view)).toContain('录屏')
  expect(hostText(view)).toContain('导入视频')
  expect(tabs).not.toContain('录屏')
})

test('an empty video filter never invents a screen-recording source or unsupported capture prompt', async () => {
  const view = await mount()
  await act(async () => { press(view, '视频') })
  expect(view.root.findByType(FlatList).props.data).toHaveLength(0)
  expect(hostText(view)).toContain('没有匹配文件')
  expect(hostText(view)).not.toContain('App 当前支持录音')
  expect(hostText(view)).not.toContain('导入视频')
})

test('contextual import binds selected purpose and cancellation starts no processing', async () => {
  const view = await mount()
  jest.mocked(importLocalFile).mockResolvedValue(null)
  await act(async () => { await press(view, '导入笔记资料') })
  expect(importLocalFile).toHaveBeenLastCalledWith({ purpose: 'note', expectedOwner: 'owner' })
  await act(async () => { press(view, '会议资料') })
  await act(async () => { await press(view, '导入会议资料') })
  expect(importLocalFile).toHaveBeenLastCalledWith({ purpose: 'meeting', expectedOwner: 'owner' })
})

test('legacy purpose is explicit, not inferred from extension; original actions survive assignment failure', async () => {
  const legacy = { ...file, purpose: undefined }
  jest.mocked(listLocalFiles).mockResolvedValue([legacy])
  jest.mocked(setLocalFilePurpose).mockRejectedValue(new Error('用途保存失败，原文件保留'))
  const view = await mount()
  expect(hostText(view)).not.toContain('source.docx')
  await act(async () => { press(view, '选择旧文件用途（1）') })
  await act(async () => { press(view, '打开文件 source.docx') })
  expect(hostText(view)).toContain('导出文件')
  expect(hostText(view)).toContain('删除原始文件')
  expect(view.root.findAll(node => node.props.title === '再生成一份笔记')).toHaveLength(0)
  await act(async () => { await press(view, '归入笔记资料') })
  expect(setLocalFilePurpose).toHaveBeenCalledWith(legacy, 'note', 'owner')
  expect(hostText(view)).toContain('用途保存失败，原文件保留')
  expect(deleteLocalFile).not.toHaveBeenCalled()
})

test('confirming purpose changes placement only, retaining the original linked note and making no generation or save calls', async () => {
  const legacy = { ...file, purpose: undefined }
  jest.mocked(listLocalFiles).mockResolvedValue([legacy])
  jest.mocked(setLocalFilePurpose).mockImplementation(async () => { jest.mocked(listLocalFiles).mockResolvedValue([file]); return file })
  const open = jest.fn(), view = await mount(open)
  await act(async () => { press(view, '选择旧文件用途（1）') })
  await act(async () => { press(view, '打开文件 source.docx') })
  await act(async () => { await press(view, '归入笔记资料') })
  expect(createTextNote).not.toHaveBeenCalled()
  expect(view.root.findByType(FileLibraryScreen).props.onSummarize).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  await act(async () => { press(view, '打开文件 source.docx') })
  await act(async () => { await press(view, '查看关联笔记：当前正文') })
  expect(open).toHaveBeenCalledWith('workspace-current-note')
})

test('partial read failure keeps material placement and existing rows until a successful explicit retry', async () => {
  const view = await mount()
  jest.mocked(listLocalFiles).mockRejectedValueOnce(new Error('read failed'))
  await act(async () => { await view.root.findByType(FlatList).props.onRefresh() })
  expect(hostText(view)).toContain('source.docx')
  expect(hostText(view)).toContain('部分文件读取失败')
  await act(async () => { await view.root.findByType(FlatList).props.onRefresh() })
  expect(hostText(view)).toContain('source.docx')
  expect(hostText(view)).not.toContain('部分文件读取失败')
})

test('delete cancellation returns to the same original without removing it or its linked note', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  try {
    const view = await mount()
    await act(async () => { press(view, '打开文件 source.docx') })
    await act(async () => { press(view, '删除原始文件') })
    const cancel = alert.mock.calls[0][2]!.find(action => action.style === 'cancel')!
    await act(async () => { cancel.onPress?.() })
    expect(hostText(view)).toContain('查看关联笔记：当前正文')
    expect(deleteLocalFile).not.toHaveBeenCalled()
  } finally { alert.mockRestore() }
})
