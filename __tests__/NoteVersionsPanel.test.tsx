import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { NoteVersionsPanel } from '../src/components/NoteVersionsPanel'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { MeetingMarkdown } from '../src/components/MeetingMarkdown'
import { listLocalNotes, noteRevisions } from '../src/lib/notes'
import { readWorkspace } from '../src/lib/workspaceStorage'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import type { Note } from '../src/types/api'
jest.mock('../src/lib/notes', () => ({ listLocalNotes: jest.fn(), noteRevisions: jest.fn(), editNoteContent: jest.fn() }))
jest.mock('../src/lib/workspaceStorage', () => ({ readWorkspace: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
jest.mock('../src/components/MeetingMarkdown', () => ({ MeetingMarkdown: () => null }))
const note: Note = { id: 'note-1', title: '同名会议', content: '当前正文', status: 'saved', created_at: '2026-10-14', updated_at: '2026-10-14', task_id: 'source', version: 3, workspace_key: 'key' }
let view: Renderer.ReactTestRenderer
const historyButtons = () => view.root.findAllByType(PrimaryButton).filter(node => /保存版本|保存正文|正文编辑|历史/.test(node.props.title))
async function mount(value = note) { await act(async () => { view = Renderer.create(<NoteVersionsPanel note={value} visible onClose={jest.fn()} onUpdated={jest.fn()} />) }) }
beforeEach(() => {
  transitionIdentity('A'); jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('A')
  jest.mocked(readWorkspace).mockResolvedValue({ mappings: {}, cache: {} } as never)
  jest.mocked(listLocalNotes).mockResolvedValue([note]); jest.mocked(noteRevisions).mockResolvedValue([])
})
afterEach(async () => { if (view) await act(async () => view.unmount()) })

test('identical titles, bodies and timestamps never merge distinct saved versions or edits', async () => {
  const timestamp = '2026-10-14', content = '相同正文'
  jest.mocked(readWorkspace).mockResolvedValue({ mappings: {}, cache: { key: { versions: [
    { id: 'remote-1', title: '历史一', content, created_at: timestamp, kind: 'generated' },
    { id: 'remote-2', title: '历史二', content, created_at: timestamp, kind: 'edit' },
  ] } } } as never)
  jest.mocked(listLocalNotes).mockResolvedValue([{ ...note, content }, { ...note, id: 'note-2', content, version: 4 }])
  jest.mocked(noteRevisions).mockResolvedValue([{ content, savedAt: timestamp }, { content, savedAt: timestamp }])
  await mount()
  expect(historyButtons()).toHaveLength(8)
  expect(historyButtons().some(button => button.props.title.includes('已保存版本 3'))).toBe(true)
  expect(historyButtons().some(button => button.props.title.includes('已保存版本 4'))).toBe(true)
  for (let index = 0; index < 8; index++) {
    await act(async () => historyButtons()[index].props.onPress())
    expect(view.root.findByType(MeetingMarkdown).props.content).toBe(content)
    await act(async () => view.root.findAllByType(PrimaryButton).find(button => button.props.title === '返回全部版本')!.props.onPress())
  }
})

test('explicit content identity includes siblings while same title and time cannot create a relationship', async () => {
  jest.mocked(listLocalNotes).mockResolvedValue([
    { ...note, content_id: 'content' },
    { ...note, id: 'related', task_id: null, workspace_key: undefined, content_id: 'content', version: 7 },
    { ...note, id: 'unrelated', task_id: null, workspace_key: undefined, content_id: 'other' },
  ])
  await mount({ ...note, content_id: 'content' })
  expect(historyButtons()).toHaveLength(2)
  expect(historyButtons().some(button => button.props.title.includes('版本 7'))).toBe(true)
  expect(noteRevisions).not.toHaveBeenCalledWith('unrelated')
})

test('delayed previous note load cannot replace newer source history', async () => {
  let finish!: (state: Awaited<ReturnType<typeof readWorkspace>>) => void
  jest.mocked(readWorkspace).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  const other = { ...note, id: 'new-note', task_id: 'new-source', title: '新来源', workspace_key: undefined }
  jest.mocked(listLocalNotes).mockResolvedValue([other])
  await act(async () => view.update(<NoteVersionsPanel note={other} visible onClose={jest.fn()} onUpdated={jest.fn()} />))
  await act(async () => finish({ mappings: {}, cache: { key: { versions: [{ id: 'old', title: '过期历史', content: '旧', created_at: '' }] } } } as never))
  expect(historyButtons()).toHaveLength(1)
  expect(historyButtons()[0].props.title).toContain('新来源')
})

test('A-B-A invalidates a delayed history read rather than adopting it in the new session', async () => {
  let finish!: (state: Awaited<ReturnType<typeof readWorkspace>>) => void
  jest.mocked(readWorkspace).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await act(async () => { transitionIdentity('B'); transitionIdentity('A') })
  await act(async () => finish({ mappings: {}, cache: {} } as never))
  expect(historyButtons()).toHaveLength(0)
  expect(listLocalNotes).not.toHaveBeenCalled()
})
