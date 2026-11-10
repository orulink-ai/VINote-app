import { ProjectsScreen } from '../src/screens/ProjectsScreen'
import { NotesScreen } from '../src/screens/NotesScreen'
import { GlobalTaskStatus } from '../src/components/GlobalTaskStatus'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import App from '../App'
import { AccountScreen } from '../src/screens/AccountScreen'
import { TasksScreen } from '../src/screens/TasksScreen'
import { StorageScreen } from '../src/screens/StorageScreen'
import { NoteDetailScreen } from '../src/screens/NoteDetailScreen'
import { WorkspaceNavigation } from '../src/components/WorkspaceNavigation'
import { Pressable } from 'react-native'
import { FileLibraryScreen } from '../src/screens/FileLibraryScreen'
import { SettingsScreen } from '../src/screens/SettingsScreen'
import { ConnectionsScreen } from '../src/screens/ConnectionsScreen'
import { NoteIntakeScreen } from '../src/screens/NoteIntakeScreen'
import { RecordingsScreen } from '../src/screens/RecordingsScreen'

jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: any) => children, SafeAreaView: ({ children }: any) => children, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('../src/lib/storage', () => ({ ...jest.requireActual('../src/lib/storage'), readToken: jest.fn(async () => 'test-session'), readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/auth', () => ({ fetchMe: jest.fn(async () => ({ id: 'owner' })), signOut: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ syncWorkspace: jest.fn(async () => {}), subscribeWorkspace: jest.fn(() => () => {}) }))
jest.mock('../src/lib/feishu', () => ({ flushAutomaticDeliveries: jest.fn(async () => {}) }))
jest.mock('../src/screens/FeishuSettingsScreen', () => ({ FeishuSettingsScreen: () => null }))
jest.mock('../src/screens/ProjectsScreen', () => ({ ProjectsScreen: () => null }))
jest.mock('../src/screens/NotesScreen', () => ({ NotesScreen: () => {
  const { ScreenHeader } = require('../src/components/ScreenHeader')
  return <ScreenHeader title="会议与笔记" />
} }))
jest.mock('../src/screens/AccountScreen', () => ({ AccountScreen: () => null }))
jest.mock('../src/screens/TasksScreen', () => ({ TasksScreen: () => null }))
jest.mock('../src/screens/StorageScreen', () => ({ StorageScreen: () => null }))
jest.mock('../src/screens/NoteDetailScreen', () => ({ NoteDetailScreen: () => null }))
jest.mock('../src/screens/FileLibraryScreen', () => ({ FileLibraryScreen: () => {
  const { ScreenHeader } = require('../src/components/ScreenHeader')
  return <ScreenHeader title="文件库" />
} }))
jest.mock('../src/screens/SettingsScreen', () => ({ SettingsScreen: () => null }))
jest.mock('../src/screens/ConnectionsScreen', () => ({ ConnectionsScreen: () => null }))
jest.mock('../src/screens/NoteIntakeScreen', () => ({ NoteIntakeScreen: () => null }))
jest.mock('../src/screens/RecordingsScreen', () => ({ RecordingsScreen: () => { const { ScreenHeader } = require('../src/components/ScreenHeader'); return <ScreenHeader title="会议" /> } }))
jest.mock('../src/components/GlobalTaskStatus', () => ({ GlobalTaskStatus: () => null }))
jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: {} }))
jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn(async () => false), setGenericPassword: jest.fn(), resetGenericPassword: jest.fn() }))
it('continues an exact source receipt through history and returns to the same history parent', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(GlobalTaskStatus).props.onPress() })
  const target = { owner: 'owner', generationOrigin: 'https://source.invalid', operationId: 'original', taskId: 'task-original' }
  await act(async () => { app.root.findByType(TasksScreen).props.onIntake(target) })
  expect(app.root.findByType(NoteIntakeScreen).props.recoveryTarget).toEqual(target)
  expect(app.root.findByType(NoteIntakeScreen).props.backLabel).toBe('返回任务与恢复')
  await act(async () => { app.root.findByType(NoteIntakeScreen).props.onSaved('saved-original') })
  expect(app.root.findByType(NoteDetailScreen).props.id).toBe('saved-original')
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  await act(async () => { app.root.findByType(TasksScreen).props.onBack() })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => app.unmount())
})

it('returns from exact note sources to the same detail and then its original filtered list', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  await act(async () => { app.root.findByType(NotesScreen).props.onOpen('word-note') })
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onSourceFiles({ id: 'word-note', title: '验收 Word' }) })
  expect(app.root.findByType(FileLibraryScreen).props.sourceNote.id).toBe('word-note')
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onBack() })
  expect(app.root.findByType(NoteDetailScreen).props.id).toBe('word-note')
  expect(app.root.findByType(NoteDetailScreen).props.backLabel).toBe('笔记')
  await act(async () => { app.unmount() })
})

it('detail exposes no sync callback and returns to its original list', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(RecordingsScreen).props.onOpenNote('original-note') })
  expect(app.root.findByType(NoteDetailScreen).props.onSync).toBeUndefined()
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => app.unmount())
})

it('returns from a note to the data settings that opened it, then to the account', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findAll(node => node.props.accessibilityLabel === '账号与设置' && typeof node.props.onPress === 'function')[0].props.onPress() })
  await act(async () => { app.root.findByType(AccountScreen).props.onSettings() })
  await act(async () => { app.root.findByType(SettingsScreen).props.onData() })
  expect(app.root.findByType(StorageScreen)).toBeDefined()
  await act(async () => { app.root.findByType(StorageScreen).props.onOpen('note-1') })
  expect(app.root.findByType(NoteDetailScreen).props.backLabel).toBe('存储')
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  expect(app.root.findByType(StorageScreen)).toBeDefined()
  await act(async () => { app.root.findByType(StorageScreen).props.onBack() })
  expect(app.root.findByType(SettingsScreen)).toBeDefined()
  await act(async () => { app.root.findByType(SettingsScreen).props.onBack() })
  expect(app.root.findByType(AccountScreen)).toBeDefined()
  await act(async () => { app.unmount() })
})


it('returns from linked content to the file library that opened it', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  await act(async () => { app.root.findByType(NotesScreen).props.onOriginals() })
  const position = { purpose: 'note', category: 'video', query: 'source', unassigned: false }
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onViewChange(position) })
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onOpenNote('file-note') })
  expect(app.root.findByType(NoteDetailScreen).props.backLabel).toBe('原文件')
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  expect(app.root.findByType(FileLibraryScreen)).toBeDefined()
  expect(app.root.findByType(FileLibraryScreen).props.view).toEqual(position)
  expect(app.root.findAllByType(WorkspaceNavigation)).toHaveLength(0)
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onBack() })
  expect(app.root.findByType(NotesScreen).props.kind).toBe('note')
  await act(async () => { app.unmount() })
})

it('returns from file generation and recording sources to the same material group', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  await act(async () => { app.root.findByType(NotesScreen).props.onOriginals() })
  const position = { purpose: 'note', category: 'file', query: 'word', unassigned: false }
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onViewChange(position) })
  const file = { id: 'original', name: 'word.docx', purpose: 'note' }
  await act(async () => { app.root.findByType(FileLibraryScreen).props.onSummarize(file) })
  expect(app.root.findByType(NoteIntakeScreen).props.initialFile).toBe(file)
  expect(app.root.findByType(NoteIntakeScreen).props.backLabel).toBe('返回原文件')
  await act(async () => { app.root.findByType(NoteIntakeScreen).props.onBack() })
  expect(app.root.findByType(FileLibraryScreen).props.view).toEqual(position)
  await act(async () => { app.unmount() })
})

it('meeting home opens an associated minute and returns to meetings', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => { app.root.findByType(RecordingsScreen).props.onOpenNote('meeting-note', 'recording-1') })
  expect(app.root.findByType(NoteDetailScreen).props.id).toBe('meeting-note')
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  expect(app.root.findByType(RecordingsScreen).props.initialFocusId).toBe('recording-1')
  await act(async () => { app.root.findByType(RecordingsScreen).props.onBack() })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => app.unmount())
})

it('opens task recovery from a main page and returns to that page', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('tasks') })
  expect(app.root.findByType(TasksScreen).props.backLabel).toBe('返回会议')
  expect(app.root.findByType(TasksScreen).props.showBack).toBe(false)
  await act(async () => { app.root.findByType(TasksScreen).props.onBack() })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => { app.unmount() })
})

it('shows a return action when tasks were opened from account', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findAll(node => node.props.accessibilityLabel === '账号与设置' && typeof node.props.onPress === 'function')[0].props.onPress() })
  await act(async () => { app.root.findByType(AccountScreen).props.onTasks() })
  expect(app.root.findByType(TasksScreen).props.showBack).toBe(true)
  expect(app.root.findByType(TasksScreen).props.backLabel).toBe('返回账号')
  await act(async () => { app.root.findByType(TasksScreen).props.onBack() })
  expect(app.root.findByType(AccountScreen)).toBeDefined()
  await act(async () => app.unmount())
})

it('returns from Feishu settings to settings and preserves the account origin', async () => {
  const { FeishuSettingsScreen } = require('../src/screens/FeishuSettingsScreen')
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  await act(async () => { app.root.findAll(node => node.props.accessibilityLabel === '账号与设置' && typeof node.props.onPress === 'function')[0].props.onPress() })
  await act(async () => { app.root.findByType(AccountScreen).props.onSettings() })
  await act(async () => { app.root.findByType(SettingsScreen).props.onConnections() })
  expect(app.root.findByType(FeishuSettingsScreen)).toBeDefined()
  await act(async () => { app.root.findByType(FeishuSettingsScreen).props.onBack() })
  await act(async () => { app.root.findByType(SettingsScreen).props.onBack() })
  await act(async () => { app.root.findByType(AccountScreen).props.onBack() })
  expect(app.root.findByType(NotesScreen).props.kind).toBe('note')
  await act(async () => { app.unmount() })
})

it('opens link/file summarization from Notes and returns generated content to Notes', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  await act(async () => { app.root.findByType(NotesScreen).props.onImport() })
  expect(app.root.findByType(NoteIntakeScreen)).toBeDefined()
  expect(app.root.findAllByType(FileLibraryScreen)).toHaveLength(0)
  await act(async () => { app.root.findByType(NoteIntakeScreen).props.onBack() })
  expect(app.root.findByType(NotesScreen).props.kind).toBe('note')
  await act(async () => { app.root.findByType(NotesScreen).props.onImport() })
  await act(async () => { app.root.findByType(NoteIntakeScreen).props.onSaved('source-note') })
  expect(app.root.findByType(NoteDetailScreen).props.backLabel).toBe('笔记')
  await act(async () => { app.root.findByType(NoteDetailScreen).props.onBack() })
  expect(app.root.findByType(NotesScreen).props.kind).toBe('note')
  await act(async () => { app.unmount() })
})

it('preserves the note filter after visiting the recording-based meeting home', async () => {
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  const noteView = { query: 'document-review.pdf', filter: '文字', project: '' }
  await act(async () => { app.root.findByType(NotesScreen).props.onViewChange(noteView) })
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('meetings') })
  expect(app.root.findByType(RecordingsScreen).props.home).toBe(true)
  await act(async () => { app.root.findByType(WorkspaceNavigation).props.onNavigate('notes') })
  expect(app.root.findByType(NotesScreen).props.view).toEqual(noteView)
  await act(async () => app.unmount())
})

it('returns a delivery settings intent once to its original saved detail and clears it on consumption', async () => {
  const { FeishuSettingsScreen } = require('../src/screens/FeishuSettingsScreen')
  const { deliverySettingsReturn } = require('../src/lib/feishuDeliveryReturn')
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => app.root.findByType(RecordingsScreen).props.onOpenNote('original-note'))
  const intent = deliverySettingsReturn('original-note', { owner: 'owner', noteKey: 'original-note', operationId: 'op' })
  await act(async () => app.root.findByType(NoteDetailScreen).props.onSettings(intent))
  const back = app.root.findByType(FeishuSettingsScreen).props.onBack
  await act(async () => { back(); back() })
  const detail = app.root.findByType(NoteDetailScreen)
  expect(detail.props.id).toBe('original-note'); expect(detail.props.deliveryReturn).toBe(intent)
  await act(async () => detail.props.onDeliveryReturnConsumed())
  expect(app.root.findByType(NoteDetailScreen).props.deliveryReturn).toBeUndefined()
  await act(async () => app.unmount())
})

it('drops an old delivery intent after an account ABA instead of navigating to old content', async () => {
  const { FeishuSettingsScreen } = require('../src/screens/FeishuSettingsScreen')
  const { deliverySettingsReturn } = require('../src/lib/feishuDeliveryReturn')
  const { transitionIdentity } = require('../src/lib/sessionIdentity')
  let app!: Renderer.ReactTestRenderer
  await act(async () => { app = Renderer.create(<App />) })
  await act(async () => app.root.findByType(RecordingsScreen).props.onOpenNote('original-note'))
  const intent = deliverySettingsReturn('original-note', { owner: 'owner', noteKey: 'original-note', operationId: 'op' })
  await act(async () => app.root.findByType(NoteDetailScreen).props.onSettings(intent))
  const delayedBack = app.root.findByType(FeishuSettingsScreen).props.onBack
  await act(async () => { transitionIdentity('other'); transitionIdentity('owner') })
  await act(async () => delayedBack())
  expect(app.root.findAllByType(NoteDetailScreen)).toHaveLength(0)
  expect(app.root.findByType(ConnectionsScreen)).toBeDefined()
  await act(async () => app.unmount())
})
