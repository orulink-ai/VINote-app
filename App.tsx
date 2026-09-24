import { RecordingsScreen } from './src/screens/RecordingsScreen'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, BackHandler, StatusBar, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { LoginScreen } from './src/screens/LoginScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { RecordScreen } from './src/screens/RecordScreen'
import { NotesScreen } from './src/screens/NotesScreen'
import { NoteDetailScreen } from './src/screens/NoteDetailScreen'
import { fetchMe, signOut } from './src/lib/auth'
import { readToken, clearToken, readAccountId } from './src/lib/storage'
import { colors, styles } from './src/design-system/theme'
import { TamaguiProvider } from 'tamagui'
import { config } from './src/design-system/tamagui'
import { ApiError } from './src/lib/api'

type Screen = 'home' | 'record' | 'recordings' | 'notes' | 'detail'

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [detailReturn, setDetailReturn] = useState<'notes' | 'recordings'>('notes')
  const [noteId, setNoteId] = useState<string | null>(null)
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
  if (authenticated === null) return <SafeAreaProvider><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></SafeAreaProvider>
  const content = !authenticated ? <LoginScreen onAuthenticated={() => setAuthenticated(true)} /> : screen === 'home' ? <HomeScreen onRecordings={() => setScreen('recordings')} onRecord={() => setScreen('record')} onNotes={() => setScreen('notes')} onSignOut={async () => { await signOut(); setScreen('home'); setNoteId(null); setAuthenticated(false) }} /> : screen === 'record' ? <RecordScreen onDone={() => setScreen('recordings')} onBack={() => setScreen('home')} /> : screen === 'recordings' ? <RecordingsScreen onBack={() => setScreen('home')} onOpenNote={id => { setDetailReturn('recordings'); setNoteId(id); setScreen('detail') }} /> : screen === 'notes' ? <NotesScreen onOpen={id => { setDetailReturn('notes'); setNoteId(id); setScreen('detail') }} onBack={() => setScreen('home')} /> : <NoteDetailScreen id={noteId!} backLabel={detailReturn === 'recordings' ? '录音库' : '纪要列表'} onBack={() => setScreen(detailReturn)} />
  return <TamaguiProvider config={config} defaultTheme="light"><SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content" />{content}</SafeAreaView></SafeAreaProvider></TamaguiProvider>
}
