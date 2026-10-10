import { RecordingsScreen } from './src/screens/RecordingsScreen'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, StatusBar, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { LoginScreen } from './src/screens/LoginScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { RecordScreen } from './src/screens/RecordScreen'
import { NotesScreen } from './src/screens/NotesScreen'
import { NoteDetailScreen } from './src/screens/NoteDetailScreen'
import { fetchMe, signOut } from './src/lib/auth'
import { readToken, clearToken, readAccountId } from './src/lib/storage'
import { colors, styles } from './src/design-system/theme'
import { ApiError } from './src/lib/api'
import { resumePendingRecordings } from './src/features/recording/generateRecording'

type Screen = 'home' | 'record' | 'recordings' | 'notes' | 'detail'

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [detailReturn, setDetailReturn] = useState<'notes' | 'recordings'>('notes')
  const [noteId, setNoteId] = useState<string | null>(null)
  const [generateId, setGenerateId] = useState<string | null>(null)
  const [importOnOpen, setImportOnOpen] = useState(false)
  const [libraryRevision, setLibraryRevision] = useState(0)
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!authenticated || screen === 'home' || screen === 'record' || screen === 'recordings') return false
      setScreen(screen === 'detail' ? detailReturn : 'home')
      return true
    })
    return () => handler.remove()
  }, [authenticated, screen, detailReturn])
  useEffect(() => {
    readToken().then(async token => {
      if (!token) return setAuthenticated(false)
      try { await fetchMe(); setAuthenticated(true) } catch (error) {
        if (error instanceof ApiError && error.status === 401) { await clearToken(); setAuthenticated(false) }
        else setAuthenticated(!!await readAccountId()) // 临时断网仍允许使用本机录音库，不清除有效凭证。
      }
    }).catch(() => setAuthenticated(false))
  }, [])
  useEffect(() => {
    if (!authenticated) return
    let active = true
    const resume = () => {
      void resumePendingRecordings(() => {}).catch(() => {}).finally(() => {
        if (active) setLibraryRevision(revision => revision + 1)
      })
    }
    resume()
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume() })
    return () => { active = false; subscription.remove() }
  }, [authenticated])
  if (authenticated === null) return <SafeAreaProvider><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></SafeAreaProvider>
  const openRecordings = (importAudio = false, recordingId?: string) => {
    setGenerateId(recordingId || null)
    setImportOnOpen(importAudio)
    setScreen('recordings')
  }
  const openNote = (id: string, source: 'notes' | 'recordings') => {
    setDetailReturn(source)
    setNoteId(id)
    setScreen('detail')
  }
  let content: React.ReactNode
  if (!authenticated) content = <LoginScreen onAuthenticated={() => setAuthenticated(true)} />
  else if (screen === 'home') content = <HomeScreen
    libraryRevision={libraryRevision}
    onRecord={() => setScreen('record')}
    onImport={() => openRecordings(true)}
    onRecordings={() => openRecordings()}
    onNotes={() => setScreen('notes')}
    onOpenNote={id => openNote(id, 'notes')}
    onSignOut={async () => { await signOut(); setScreen('home'); setNoteId(null); setAuthenticated(false) }} />
  else if (screen === 'record') content = <RecordScreen onDone={id => openRecordings(false, id)} onBack={() => setScreen('home')} />
  else if (screen === 'recordings') content = <RecordingsScreen
    initialGenerateId={generateId}
    initialImport={importOnOpen}
    onBack={() => { setGenerateId(null); setImportOnOpen(false); setScreen('home') }}
    onOpenNote={id => { setImportOnOpen(false); openNote(id, 'recordings') }} />
  else if (screen === 'notes') content = <NotesScreen onOpen={id => openNote(id, 'notes')} onBack={() => setScreen('home')} />
  else content = <NoteDetailScreen id={noteId!} backLabel={detailReturn === 'recordings' ? '录音库' : '纪要列表'} onBack={() => setScreen(detailReturn)} />
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content" />{content}</SafeAreaView></SafeAreaProvider>
}
