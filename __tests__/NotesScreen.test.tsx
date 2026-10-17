import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FlatList } from 'react-native'
import { NotesScreen } from '../src/screens/NotesScreen'
import { Field } from '../src/components/Field'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { listNotes } from '../src/lib/notes'
import { subscribeWorkspace, syncWorkspace } from '../src/lib/workspace'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({
  syncWorkspace: jest.fn(async () => {}),
  subscribeWorkspace: jest.fn(() => () => {}),
}))

const makeNote = (source_type: string, extra: Partial<Note> = {}): Note => ({
  id: source_type, title: source_type, content: '已保存内容', source_type,
  status: 'done', created_at: '2026-10-12', updated_at: '2026-10-12', ...extra,
})
let view: Renderer.ReactTestRenderer
const list = () => view.root.findByType(FlatList).props
const textOf = (node: React.ReactNode): string => {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (React.isValidElement<{ children?: React.ReactNode; title?: string }>(node)) return `${node.props.title || ''} ${textOf(node.props.children)}`
  return ''
}
const emptyText = () => textOf(list().ListEmptyComponent)
const renderScreen = async (kind: 'meeting' | 'note' = 'note') => {
  await act(async () => { view = Renderer.create(<NotesScreen kind={kind} onOpen={jest.fn()} />) })
}
const selectFilter = async (label: string) => {
  const tab = view.root.findAll(node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function' && textOf(node.props.children).trim() === label)[0]
  await act(async () => tab.props.onPress())
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(listNotes).mockResolvedValue([])
  jest.mocked(syncWorkspace).mockResolvedValue(undefined)
  jest.mocked(subscribeWorkspace).mockImplementation(() => () => {})
})

test('returning with this account cached rows keeps reading while background read fails', async () => {
  const cached = makeNote('file', { title: '已保存文档' }), onNotesChange = jest.fn()
  let rejectRead!: (error: Error) => void
  jest.mocked(listNotes).mockImplementation(() => new Promise((_, reject) => { rejectRead = reject }))
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" initialNotes={[cached]} onNotesChange={onNotesChange} onOpen={jest.fn()} />) })
  expect(list().data).toEqual([cached])
  expect(list().refreshing).toBe(false)
  await act(async () => rejectRead(new Error('本地读取失败')))
  expect(list().data).toEqual([cached])
  expect(list().refreshing).toBe(false)
  expect(onNotesChange).not.toHaveBeenCalled()
})

test('sync notifications coalesce reads without discarding the first completed cache', async () => {
  let notify!: () => void, resolveRead!: (notes: Note[]) => void
  jest.mocked(subscribeWorkspace).mockImplementation(listener => { notify = listener; return () => {} })
  const first = makeNote('file'), next = makeNote('document'), onNotesChange = jest.fn()
  jest.mocked(listNotes).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve })).mockResolvedValue([next])
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" onNotesChange={onNotesChange} onOpen={jest.fn()} />) })
  await act(async () => { notify(); notify(); notify() })
  expect(listNotes).toHaveBeenCalledTimes(1)
  await act(async () => resolveRead([first]))
  expect(listNotes).toHaveBeenCalledTimes(2)
  expect(onNotesChange.mock.calls.map(call => call[0])).toEqual([[first], [next]])
  expect(list().data).toEqual([next])
})

test('a content revision during an unfinished read still publishes cache and reads the latest change', async () => {
  let resolveRead!: (notes: Note[]) => void
  const first = makeNote('file'), next = makeNote('document'), onNotesChange = jest.fn()
  jest.mocked(listNotes).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve })).mockResolvedValue([next])
  await act(async () => { view = Renderer.create(<NotesScreen revision={1} onNotesChange={onNotesChange} onOpen={jest.fn()} />) })
  await act(async () => view.update(<NotesScreen revision={2} onNotesChange={onNotesChange} onOpen={jest.fn()} />))
  expect(listNotes).toHaveBeenCalledTimes(1)
  await act(async () => resolveRead([first]))
  expect(onNotesChange.mock.calls.map(call => call[0])).toEqual([[first], [next]])
  expect(list().data).toEqual([next])
})
afterEach(async () => { if (view) await act(async () => view.unmount()) })

test('文档与文字 includes saved documents and transcripts without including audio, video or meetings', async () => {
  jest.mocked(listNotes).mockResolvedValue(['text', 'file', 'document', 'transcript', 'audio', 'video', 'meeting_recording'].map(type => makeNote(type)))
  await renderScreen()
  await selectFilter('文档与文字')
  expect(list().data.map((note: Note) => note.id)).toEqual(['text', 'file', 'document', 'transcript'])
})

test.each([['note', '笔记'], ['meeting', '会议']] as const)('search empty state describes %s accurately and can clear the query', async (kind, noun) => {
  await renderScreen(kind)
  const field = view.root.findByType(Field)
  expect(field.props.label).toBe(`搜索${noun}`)
  await act(async () => field.props.onChangeText('没有匹配'))
  expect(emptyText()).toContain(`没有找到匹配的${noun}`)
  expect(emptyText()).not.toContain('粘贴网页')
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '清除筛选')!.props.onPress())
  expect(view.root.findByType(Field).props.value).toBe('')
})

test('a type filter with no results offers reset rather than claiming the library is empty', async () => {
  jest.mocked(listNotes).mockResolvedValue([makeNote('file')])
  await renderScreen()
  await selectFilter('音视频')
  expect(list().data).toHaveLength(0)
  expect(emptyText()).toContain('没有找到匹配的笔记')
  expect(emptyText()).not.toContain('还没有保存')
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '清除筛选')!.props.onPress())
  expect(list().data).toHaveLength(1)
})

test('meetings empty content has an actionable original-material path without claiming saved recordings are absent', async () => {
  const originals = jest.fn()
  await act(async () => { view = Renderer.create(<NotesScreen kind="meeting" onOpen={jest.fn()} onOriginals={originals} />) })
  expect(emptyText()).toContain('还没有会议纪要')
  expect(emptyText()).not.toContain('还没有保存的会议')
  const action = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '查看录音与会议资料')!
  await act(async () => action.props.onPress())
  expect(originals).toHaveBeenCalledTimes(1)
  expect(list().data).toHaveLength(0)
  expect(syncWorkspace).not.toHaveBeenCalled()
})

test('loading shows only loading status, without creation hints or reset actions', async () => {
  jest.mocked(listNotes).mockImplementation(() => new Promise(() => {}))
  await renderScreen()
  expect(emptyText()).toContain('正在加载')
  expect(emptyText()).not.toContain('粘贴网页')
  expect(emptyText()).not.toContain('清除筛选')
})

test('load failure does not display a creation empty state', async () => {
  jest.mocked(listNotes).mockRejectedValue(new Error('无法读取缓存'))
  await renderScreen()
  expect(list().ListEmptyComponent).toBeUndefined()
})

test('archive and project filters remain in effect when showing text documents', async () => {
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('file', { project: '评审' }),
    makeNote('document', { project: '评审', archived: true }),
    makeNote('transcript', { project: '其他' }),
  ])
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" initialProject="评审" onOpen={jest.fn()} />) })
  await selectFilter('文档与文字')
  expect(list().data.map((note: Note) => note.id)).toEqual(['file'])
  await selectFilter('归档')
  expect(list().data.map((note: Note) => note.id)).toEqual(['document'])
})

test('clearing a search in project context does not show notes from another project', async () => {
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('file', { project: '评审' }),
    makeNote('document', { project: '其他' }),
  ])
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" initialProject="评审" onOpen={jest.fn()} />) })
  await act(async () => view.root.findByType(Field).props.onChangeText('没有匹配'))
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '清除筛选')!.props.onPress())
  expect(list().data.map((note: Note) => note.id)).toEqual(['file'])
})

test.each([1, 7, undefined])('list does not present generated count %s as a complete version number', async version => {
  const note = makeNote('file', {
    title: '导入文档', content: '第五次保存后的正文', version, workspace_revision: 9,
  })
  jest.mocked(listNotes).mockResolvedValue([note])
  await renderScreen()
  const row = list().renderItem({ item: list().data[0] })
  expect(textOf(row)).toContain('当前正文')
  expect(textOf(row)).toContain('第五次保存后的正文')
  expect(textOf(row)).not.toMatch(/版本\s*\d|V\d|已同步|共\s*\d+\s*版/)
  expect(row.props.accessibilityLabel).toContain('当前正文')
  expect(row.props.accessibilityLabel).not.toMatch(/版本\s*\d|V\d|已同步|共\s*\d+\s*版/)
  expect(list().data[0]).toEqual(note)
})

test('current body label preserves the exact detail target and does not refetch history on open', async () => {
  const onOpen = jest.fn()
  const note = makeNote('meeting_recording', { id: 'workspace-known-key', title: '已保存会议', version: 1 })
  jest.mocked(listNotes).mockResolvedValue([note])
  await act(async () => { view = Renderer.create(<NotesScreen kind="meeting" onOpen={onOpen} />) })
  const reads = jest.mocked(listNotes).mock.calls.length
  const syncs = jest.mocked(syncWorkspace).mock.calls.length
  const row = list().renderItem({ item: list().data[0] })
  expect(textOf(row)).toMatch(/会议纪要\s*·\s*当前正文/)
  await act(async () => row.props.onPress())
  expect(onOpen).toHaveBeenCalledWith('workspace-known-key')
  expect(listNotes).toHaveBeenCalledTimes(reads)
  expect(syncWorkspace).toHaveBeenCalledTimes(syncs)
})

test('controlled view is read immediately and mount does not overwrite the parent snapshot', async () => {
  const onViewChange = jest.fn()
  const snapshot = { query: '保留', filter: '归档', project: '评审' }
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('file', { title: '保留文档', project: '评审', archived: true }),
    makeNote('text', { title: '保留文档', project: '其他', archived: true }),
  ])
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" view={snapshot} onViewChange={onViewChange} onOpen={jest.fn()} />) })
  expect(view.root.findByType(Field).props.value).toBe('保留')
  expect(list().data.map((note: Note) => note.id)).toEqual(['file'])
  expect(onViewChange).not.toHaveBeenCalled()
  const reads = jest.mocked(listNotes).mock.calls.length
  const syncs = jest.mocked(syncWorkspace).mock.calls.length
  await act(async () => view.root.findByType(Field).props.onChangeText('修改'))
  expect(onViewChange).toHaveBeenLastCalledWith({ ...snapshot, query: '修改' })
  expect(view.root.findByType(Field).props.value).toBe('保留')
  expect(listNotes).toHaveBeenCalledTimes(reads)
  expect(syncWorkspace).toHaveBeenCalledTimes(syncs)
})

test('parent-owned meeting and note views survive unmount independently', async () => {
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('file', { title: '文档保留', project: '评审', archived: true }),
    makeNote('meeting_recording', { title: '会议保留', project: '会议项目', archived: true }),
  ])
  const Host = ({ show, kind }: { show: boolean; kind: 'meeting' | 'note' }) => {
    const [noteView, setNoteView] = React.useState({ query: '', filter: '全部', project: '' })
    const [meetingView, setMeetingView] = React.useState({ query: '', filter: '全部', project: '' })
    return show ? <NotesScreen kind={kind} view={kind === 'meeting' ? meetingView : noteView} onViewChange={kind === 'meeting' ? setMeetingView : setNoteView} onOpen={jest.fn()} /> : null
  }
  const selectProject = async (label: string) => {
    const button = view.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && textOf(node.props.children).trim() === label)[0]
    await act(async () => button.props.onPress())
  }
  await act(async () => { view = Renderer.create(<Host show kind="note" />) })
  await act(async () => view.root.findByType(Field).props.onChangeText('文档'))
  await selectFilter('归档')
  await selectProject('评审')
  await act(async () => view.update(<Host show={false} kind="note" />))
  await act(async () => view.update(<Host show kind="meeting" />))
  expect(view.root.findByType(Field).props.value).toBe('')
  await act(async () => view.root.findByType(Field).props.onChangeText('会议'))
  await selectFilter('归档')
  await selectProject('会议项目')
  await act(async () => view.update(<Host show={false} kind="meeting" />))
  await act(async () => view.update(<Host show kind="note" />))
  expect(view.root.findByType(Field).props.value).toBe('文档')
  expect(list().data.map((note: Note) => note.id)).toEqual(['file'])
  await act(async () => view.update(<Host show={false} kind="note" />))
  await act(async () => view.update(<Host show kind="meeting" />))
  expect(view.root.findByType(Field).props.value).toBe('会议')
  expect(list().data.map((note: Note) => note.id)).toEqual(['meeting_recording'])
})

test('fixed project overrides the supplied project and clearing cannot leave the category or project', async () => {
  const onViewChange = jest.fn(), onChangeKind = jest.fn()
  const snapshot = { query: '', filter: '归档', project: '其他' }
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('meeting_recording', { project: '评审', archived: true }),
    makeNote('meeting_video', { project: '其他', archived: true }),
    makeNote('text', { project: '评审', archived: true }),
  ])
  await act(async () => { view = Renderer.create(<NotesScreen kind="meeting" initialProject="评审" view={snapshot} onViewChange={onViewChange} onChangeKind={onChangeKind} onOpen={jest.fn()} />) })
  expect(list().data.map((note: Note) => note.id)).toEqual(['meeting_recording'])
  await act(async () => view.root.findByType(Field).props.onChangeText('不匹配'))
  expect(onViewChange).toHaveBeenLastCalledWith({ query: '不匹配', filter: '归档', project: '评审' })
  await act(async () => view.update(<NotesScreen kind="meeting" initialProject="评审" view={{ ...snapshot, query: '不匹配' }} onViewChange={onViewChange} onChangeKind={onChangeKind} onOpen={jest.fn()} />))
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '清除筛选')!.props.onPress())
  expect(onViewChange).toHaveBeenLastCalledWith({ query: '', filter: '全部', project: '评审' })
  expect(onChangeKind).not.toHaveBeenCalled()
  await act(async () => view.update(<NotesScreen kind="meeting" initialProject="其他" view={snapshot} onViewChange={onViewChange} onOpen={jest.fn()} />))
  expect(list().data.map((note: Note) => note.id)).toEqual(['meeting_video'])
})

test('parent reset immediately replaces search, archive and project without a new request', async () => {
  const onViewChange = jest.fn()
  jest.mocked(listNotes).mockResolvedValue([
    makeNote('file', { title: '保留', project: '评审', archived: true }),
    makeNote('text'),
  ])
  await act(async () => { view = Renderer.create(<NotesScreen kind="note" view={{ query: '保留', filter: '归档', project: '评审' }} onViewChange={onViewChange} onOpen={jest.fn()} />) })
  expect(view.root.findByType(Field).props.value).toBe('保留')
  expect(list().data.map((note: Note) => note.id)).toEqual(['file'])
  const reads = jest.mocked(listNotes).mock.calls.length
  const syncs = jest.mocked(syncWorkspace).mock.calls.length
  await act(async () => view.update(<NotesScreen kind="note" view={{ query: '', filter: '全部', project: '' }} onViewChange={onViewChange} onOpen={jest.fn()} />))
  expect(view.root.findByType(Field).props.value).toBe('')
  expect(list().data.map((note: Note) => note.id)).toEqual(['text'])
  expect(listNotes).toHaveBeenCalledTimes(reads)
  expect(syncWorkspace).toHaveBeenCalledTimes(syncs)
  expect(onViewChange).not.toHaveBeenCalled()
})
