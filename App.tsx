// @refresh reset
import { GentleEntrance } from './src/components/AsyncState'
import { RecordingMiniBar } from './src/components/RecordingMiniBar'
import { AccountScreen } from './src/screens/AccountScreen'
import { ModelSettingsScreen } from './src/screens/ModelSettingsScreen'
import { ProjectsScreen } from './src/screens/ProjectsScreen'
import { AppearanceScreen } from './src/screens/AppearanceScreen'
import { WorkspaceNavigation } from './src/components/WorkspaceNavigation'
import { RecordingsScreen } from './src/screens/RecordingsScreen'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Alert, AppState, BackHandler, StatusBar, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { LoginScreen } from './src/screens/LoginScreen'
import { FeishuSettingsScreen } from './src/screens/FeishuSettingsScreen'
import { RecordScreen, type RecordingCaptureState } from './src/screens/RecordScreen'
import { NotesScreen, type NotesView } from './src/screens/NotesScreen'
import { NoteDetailScreen } from './src/screens/NoteDetailScreen'
import { signOut } from './src/lib/auth'
import { useTrustedSession } from './src/lib/useTrustedSession'
import { colors, styles, useAppAppearance } from './src/design-system/theme'
import { TextNoteScreen } from './src/screens/TextNoteScreen'
import { TasksScreen } from './src/screens/TasksScreen'
import { MCPScreen } from './src/screens/MCPScreen'
import type { Note } from './src/types/api'
import { GlobalTaskStatus } from './src/components/GlobalTaskStatus'
import { ConnectionsScreen } from './src/screens/ConnectionsScreen'
import { ContentPluginsScreen } from './src/screens/ContentPluginsScreen'
import { Text } from './src/components/AppText'
import { FileLibraryScreen } from './src/screens/FileLibraryScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { NoteIntakeScreen } from './src/screens/NoteIntakeScreen'
import type { LocalFile } from './src/lib/localFiles'
import type { FileLibraryView } from './src/screens/FileLibraryScreen'
import { MainAccountActionContext } from './src/components/ScreenHeader'
import { StorageScreen } from './src/screens/StorageScreen'
import { deliveryReturnCurrent, type FeishuDeliveryReturn } from './src/lib/feishuDeliveryReturn'
import { subscribeIdentity } from './src/lib/sessionIdentity'
import type { IntakeHistoryTarget } from './src/lib/intakeHistory'

type Screen = 'sourceFiles' | 'meetings' | 'projects' | 'projectContent' | 'record' | 'recordings' | 'notes' | 'detail' | 'feishu' | 'account' | 'settings' | 'settingsPlugins' | 'files' | 'text' | 'noteIntake' | 'tasks' | 'mcp' | 'connections' | 'contentPlugins' | 'models' | 'appearance' | 'data'

export default function App() {
  const dark = useAppAppearance()
  const { readable: authenticated, mode: sessionMode, message: sessionError, retry, restart, showLogin } = useTrustedSession()
  const feishuParent = useRef<Screen>('notes')
  const [screen, setScreen] = useState<Screen>('meetings')
  const currentDetail = useRef<{ screen: Screen; noteId: string | null }>({ screen: 'meetings', noteId: null })
  const settingsDelivery = useRef<FeishuDeliveryReturn | undefined>(undefined)
  const [deliveryReturn, setDeliveryReturn] = useState<FeishuDeliveryReturn>()
  const feishuBackUsed = useRef(false)
  const consumeDeliveryReturn = useCallback(() => setDeliveryReturn(undefined), [])
  useEffect(() => subscribeIdentity(() => {
    settingsDelivery.current = undefined
    setDeliveryReturn(undefined)
    // Do not return an old saved-content selection after an ABA account switch.
    feishuParent.current = 'connections'
  }), [])
  const openFeishu = (resume?: FeishuDeliveryReturn) => {
    if (currentDetail.current.screen !== 'detail' || currentDetail.current.noteId !== noteId || (resume && !deliveryReturnCurrent(resume, currentDetail.current.noteId))) return
    currentDetail.current.screen = 'feishu'
    settingsDelivery.current = resume
    setDeliveryReturn(undefined)
    feishuBackUsed.current = false
    feishuParent.current = 'detail'
    setScreen('feishu')
  }
  const returnFeishu = () => {
    if (feishuBackUsed.current || currentDetail.current.screen !== 'feishu') return
    feishuBackUsed.current = true
    const resume = settingsDelivery.current
    settingsDelivery.current = undefined
    if (resume && deliveryReturnCurrent(resume, noteId)) {
      setDeliveryReturn(resume)
      setScreen('detail')
    } else { setDeliveryReturn(undefined); setScreen(resume ? 'connections' : feishuParent.current) }
  }
  const [intakeMode, setIntakeMode] = useState<'url' | 'file'>('url')
  const [intakeReturn, setIntakeReturn] = useState<Screen>('notes')
  const [intakeFile, setIntakeFile] = useState<LocalFile | undefined>()
  const [intakeTarget, setIntakeTarget] = useState<IntakeHistoryTarget | undefined>()
  const [fileLibraryView, setFileLibraryView] = useState<FileLibraryView>({ purpose: 'meeting', category: 'all', query: '' })
  const [contentViews, setContentViews] = useState<Record<'notes' | 'meetings', NotesView>>({ notes: { query: '', filter: '全部', project: '' }, meetings: { query: '', filter: '全部', project: '' } })
  const [contentRows, setContentRows] = useState<Note[] | undefined>()
  const [projectViews, setProjectViews] = useState<Map<string, NotesView>>(() => new Map())
  const [accountReturn, setAccountReturn] = useState<Screen>('meetings')
  const [selectedProject, setSelectedProject] = useState('')
  const [tasksReturn, setTasksReturn] = useState<Screen>('meetings')
  const [detailReturn, setDetailReturn] = useState<Screen>('notes')
  const [dataReturn, setDataReturn] = useState<{ screen: 'settings' } | { screen: 'detail'; noteId: string; source: Screen }>({ screen: 'settings' })
  const [sourceNote, setSourceNote] = useState<Note | undefined>()
  const [noteId, setNoteId] = useState<string | null>(null)
  currentDetail.current = { screen, noteId }
  const [focusId, setFocusId] = useState<string | null>(null)
  const [generateId, setGenerateId] = useState<string | null>(null)
  const [recordingsReturn, setRecordingsReturn] = useState<Screen>('meetings')
  const [importOnOpen, setImportOnOpen] = useState(false)
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [captureReturn, setCaptureReturn] = useState<Screen>('meetings')
  const [recorderMounted, setRecorderMounted] = useState(false)
  const [capture, setCapture] = useState<RecordingCaptureState>({ active: false, paused: false, seconds: 0, unsaved: false, status: 'idle' })
  const captureRef = useRef(capture)
  const onCapture = useCallback((value: typeof capture) => { captureRef.current = value; setCapture(value) }, [])
  const [toolNote, setToolNote] = useState<Note | undefined>()
  const [toolReturn, setToolReturn] = useState<Screen>('account')
  const [pluginReturn, setPluginReturn] = useState<Screen>('connections')
  const [contentPlugin, setContentPlugin] = useState<'translation' | 'diagram'>('diagram')
  useEffect(() => {
    if (authenticated !== false) return
    settingsDelivery.current = undefined; setDeliveryReturn(undefined)
    setIntakeFile(undefined)
    setIntakeTarget(undefined)
    setSourceNote(undefined)
    setDataReturn({ screen: 'settings' })
    setIntakeReturn('notes')
    setFileLibraryView({ purpose: 'meeting', category: 'all', query: '' })
    setContentViews({ notes: { query: '', filter: '全部', project: '' }, meetings: { query: '', filter: '全部', project: '' } })
    setContentRows(undefined)
    setProjectViews(new Map()); setSelectedProject(''); setToolNote(undefined); setNoteId(null)
  }, [authenticated])
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!authenticated || screen === 'record' || screen === 'recordings' || screen === 'feishu' || screen === 'text' || screen === 'noteIntake') return false
      if (screen === 'notes' || screen === 'meetings') {
        if (capture.active || capture.unsaved) { setScreen('record'); return true }
        return false
      }
      if (screen === 'data') {
        if (dataReturn.screen === 'detail') { setNoteId(dataReturn.noteId); setDetailReturn(dataReturn.source); setScreen('detail') }
        else setScreen('settings')
        return true
      }
      setScreen(screen === 'contentPlugins' ? pluginReturn : screen === 'tasks' ? tasksReturn : screen === 'projectContent' ? 'projects' : screen === 'sourceFiles' ? 'detail' : screen === 'detail' ? detailReturn : ['models', 'appearance', 'data', 'settingsPlugins'].includes(screen) ? 'settings' : screen === 'settings' ? 'account' : screen === 'account' ? accountReturn : screen === 'mcp' ? toolReturn : 'meetings')
      return true
    })
    return () => handler.remove()
  }, [authenticated, screen, detailReturn, dataReturn, tasksReturn, toolReturn, accountReturn, pluginReturn, capture.active, capture.unsaved])
  if (authenticated === null) return <SafeAreaProvider><View style={[styles.loading, { gap: 16 }]}><ActivityIndicator color={colors.primary} /><Text accessibilityRole="alert" style={styles.subtitle}>{sessionError}</Text><Pressable accessibilityRole="button" onPress={retry} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={styles.link}>重新核验账号</Text></Pressable></View></SafeAreaProvider>
  const openRecordings = (importAudio = false, recordingId?: string) => {
    setRecordingsReturn(screen === 'record' ? captureReturn : screen === 'recordings' ? recordingsReturn : screen)
    setFocusId(null)
    setGenerateId(recordingId || null)
    setImportOnOpen(importAudio)
    setScreen('recordings')
  }
  const openNote = (id: string, source: Screen) => {
    settingsDelivery.current = undefined; setDeliveryReturn(undefined)
    setDetailReturn(source)
    currentDetail.current = { screen: 'detail', noteId: id }
    setNoteId(id)
    setScreen('detail')
  }
  const tools = (source: Screen, note?: Note) => { setToolNote(note); setToolReturn(source); setScreen('mcp') }
  let content: React.ReactNode
  if (!authenticated) content = <LoginScreen onAuthenticated={() => { setScreen('meetings'); setNoteId(null); setToolNote(undefined); setFocusId(null); setGenerateId(null); setImportOnOpen(false); restart() }} />
  else if (screen === 'text') content = <TextNoteScreen onBack={() => setScreen('notes')} onSaved={id => { setLibraryRevision(value => value + 1); openNote(id, 'notes') }} />
  else if (screen === 'noteIntake') content = <NoteIntakeScreen recoveryTarget={intakeTarget} initialMode={intakeMode} initialFile={intakeFile} backLabel={intakeReturn === 'files' ? '返回文件库' : intakeReturn === 'tasks' ? '返回任务与恢复' : '返回笔记'} onBack={() => setScreen(intakeReturn)} onSaved={id => { setLibraryRevision(value => value + 1); openNote(id, intakeReturn) }} />
  else if (screen === 'connections' || screen === 'settingsPlugins') content = <ConnectionsScreen onBack={screen === 'settingsPlugins' ? () => setScreen('settings') : undefined} onFeishu={() => { settingsDelivery.current = undefined; setDeliveryReturn(undefined); feishuBackUsed.current = false; feishuParent.current = screen; setScreen('feishu') }} onMcp={() => tools(screen)} onContentPlugin={id => { if (id === 'translation') { tools(screen); return }; setContentPlugin(id); setToolNote(undefined); setPluginReturn(screen); setScreen('contentPlugins') }} />
  else if (screen === 'contentPlugins') content = <ContentPluginsScreen note={toolNote} initialPlugin={contentPlugin} onBack={() => setScreen(pluginReturn)} onOpen={id => openNote(id, pluginReturn === 'detail' ? detailReturn : pluginReturn)} />
  else if (screen === 'sourceFiles' && sourceNote) content = <FileLibraryScreen sourceNote={sourceNote} onBack={() => setScreen('detail')} onRecording={() => {}} onOpenNote={() => setScreen('detail')} />
  else if (screen === 'files') content = <FileLibraryScreen view={fileLibraryView} onViewChange={setFileLibraryView} onSummarize={file => { setIntakeTarget(undefined); setIntakeFile(file); setIntakeMode('file'); setIntakeReturn('files'); setScreen('noteIntake') }} onRecording={id => { setRecordingsReturn('files'); setGenerateId(null); setImportOnOpen(false); setFocusId(id); setScreen('recordings') }} onOpenNote={id => openNote(id, 'files')} />
  else if (screen === 'settings') content = <SettingsScreen onBack={() => setScreen('account')} onAppearance={() => setScreen('appearance')} onModels={() => setScreen('models')} onData={() => { setDataReturn({ screen: 'settings' }); setScreen('data') }} onConnections={() => setScreen('settingsPlugins')} />
  else if (screen === 'models') content = <ModelSettingsScreen onBack={() => setScreen('settings')} />
  else if (screen === 'appearance') content = <AppearanceScreen onBack={() => setScreen('settings')} />
  else if (screen === 'data') content = <StorageScreen onBack={() => setScreen('settings')} onFiles={() => setScreen('files')} onOpen={id => openNote(id, 'data')} />
  else if (screen === 'projects') content = <ProjectsScreen onSelect={project => { setSelectedProject(project); setScreen('projectContent') }} onContent={() => setScreen('notes')} />
  else if (screen === 'projectContent') content = <NotesScreen initialNotes={contentRows} onNotesChange={setContentRows} key={selectedProject} initialProject={selectedProject} view={projectViews.get(selectedProject) || { query: '', filter: '全部', project: selectedProject }} onViewChange={value => setProjectViews(current => new Map(current).set(selectedProject, value))} onBack={() => setScreen('projects')} revision={libraryRevision} onOpen={id => openNote(id, 'projectContent')} />
  else if (screen === 'tasks') content = <TasksScreen onIntake={target => { setIntakeFile(undefined); setIntakeTarget(target); setIntakeReturn('tasks'); setScreen('noteIntake') }} onBack={() => setScreen(tasksReturn)} backLabel={tasksReturn === 'files' ? '返回文件库' : tasksReturn === 'connections' ? '返回插件' : tasksReturn === 'projects' ? '返回项目' : tasksReturn === 'account' ? '返回账号' : tasksReturn === 'meetings' ? '返回会议' : '返回笔记'} onOpen={id => openNote(id, 'tasks')} onRecording={id => { openRecordings(); setFocusId(id) }} onMcp={() => tools('tasks')} />
  else if (screen === 'mcp') content = <MCPScreen note={toolNote} onBack={() => setScreen(toolReturn)} />
  else if (screen === 'feishu') content = <FeishuSettingsScreen onBack={returnFeishu} />
  else if (screen === 'account') content = <AccountScreen onBack={() => setScreen(accountReturn)} onSettings={() => setScreen('settings')} onAppearance={() => setScreen('appearance')} onModels={() => setScreen('models')} onTasks={() => { setTasksReturn('account'); setScreen('tasks') }} onRecordings={() => setScreen('files')} onConnections={() => setScreen('connections')} onSignOut={async () => { if (capture.active || capture.unsaved) { Alert.alert('录音尚未保存', '请返回录音控制结束并保存后再退出。'); return }; try { await signOut(); setRecorderMounted(false); setScreen('meetings'); setNoteId(null); setFocusId(null); setGenerateId(null); setToolNote(undefined); restart() } catch (cause) { Alert.alert('退出失败', cause instanceof Error ? cause.message : '请重试') } }} />
  else if (screen === 'record') content = null
  else if (screen === 'recordings') content = <RecordingsScreen
    initialFocusId={focusId}
    initialGenerateId={generateId}
    initialImport={importOnOpen}
    backLabel={recordingsReturn === 'files' ? '返回文件库' : recordingsReturn === 'detail' ? '返回会议详情' : recordingsReturn === 'tasks' ? '返回处理记录' : recordingsReturn === 'data' ? '返回存储' : recordingsReturn === 'meetings' ? '返回会议' : '返回笔记'}
    onBack={() => { setGenerateId(null); setImportOnOpen(false); setScreen(recordingsReturn) }}
    onOpenNote={id => { setImportOnOpen(false); openNote(id, 'recordings') }} />
  else if ((screen === 'notes' || screen === 'meetings')) content = <NotesScreen initialNotes={contentRows} onNotesChange={setContentRows} key={screen} kind={screen === 'meetings' ? 'meeting' : 'note'} view={contentViews[screen]} onViewChange={value => setContentViews(current => ({ ...current, [screen]: value }))} revision={libraryRevision} onOriginals={screen === 'meetings' ? () => { setFileLibraryView({ purpose: 'meeting', category: 'all', query: '' }); setScreen('files') } : undefined} onRecord={() => { setCaptureReturn(screen); setRecorderMounted(true); setScreen('record') }} onImport={mode => { if (screen === 'meetings') openRecordings(true); else { setIntakeTarget(undefined); setIntakeFile(undefined); setIntakeReturn('notes'); setIntakeMode(mode || 'url'); setScreen('noteIntake') } }} onNew={() => setScreen('text')} onOpen={id => openNote(id, screen)} />
  else content = <NoteDetailScreen onSourceFiles={note => { setSourceNote(note); setScreen('sourceFiles') }} onContentPlugins={note => { setToolNote(note); setPluginReturn('detail'); setScreen('contentPlugins') }} onTools={note => tools('detail', note)} initialTab="纪要" id={noteId!} onRecording={id => { openRecordings(); setFocusId(id) }} onSettings={openFeishu} deliveryReturn={deliveryReturn} onDeliveryReturnConsumed={consumeDeliveryReturn} backLabel={detailReturn === 'files' ? '文件库' : detailReturn === 'recordings' ? '录音详情' : detailReturn === 'tasks' ? '任务与恢复' : detailReturn === 'data' ? '存储' : detailReturn === 'projectContent' ? selectedProject : detailReturn === 'meetings' ? '会议' : '笔记'} onBack={() => setScreen(detailReturn)} />
  const mainDestination = screen === 'meetings' || screen === 'notes' || screen === 'files' || screen === 'connections' ? screen : null
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />{authenticated && sessionError && <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySoft }}><Text accessibilityRole="alert" style={[styles.subtitle, { flex: 1 }]}>{sessionError}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新核验连接" onPress={() => { if (sessionMode === 'expired') { if (capture.active || capture.unsaved) { Alert.alert('录音尚未保存', '请先结束并保存本机录音，再重新登录。'); return }; showLogin() } else retry() }} style={{ minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'center' }}><Text style={styles.link}>{sessionMode === 'expired' ? '重新登录' : '重新核验'}</Text></Pressable></View>}{authenticated && (mainDestination || screen === 'projects') && <GlobalTaskStatus onPress={() => { setTasksReturn(screen); setScreen('tasks') }} />}{screen === 'record' && authenticated ? null : <MainAccountActionContext.Provider value={authenticated && (mainDestination || screen === 'projects') ? () => { setAccountReturn(screen); setScreen('account') } : undefined}><GentleEntrance transitionKey={screen}>{content}</GentleEntrance></MainAccountActionContext.Provider>}
    {authenticated && recorderMounted && <View style={{ flex: screen === 'record' ? 1 : 0, display: screen === 'record' ? 'flex' : 'none' }}><RecordScreen visible={screen === 'record'} onState={onCapture} onDone={id => { setRecorderMounted(false); onCapture({ active: false, paused: false, seconds: 0, unsaved: false }); openRecordings(false, id) }} onBack={() => setScreen(captureReturn)} /></View>}
    {authenticated && screen !== 'record' && (capture.active || capture.unsaved) && <RecordingMiniBar paused={capture.paused} seconds={capture.seconds} saving={capture.unsaved} status={capture.status} onExpand={() => setScreen('record')} />}
    {authenticated && mainDestination && <WorkspaceNavigation selected={mainDestination} onNavigate={setScreen} />}
  </SafeAreaView></SafeAreaProvider>
}
