import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StatusBar, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LoginScreen } from './src/screens/LoginScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { RecordScreen } from './src/screens/RecordScreen'
import { NotesScreen } from './src/screens/NotesScreen'
import { NoteDetailScreen } from './src/screens/NoteDetailScreen'
import { fetchMe, signOut } from './src/lib/auth'
import { readToken, clearToken } from './src/lib/storage'
import { colors, styles } from './src/design-system/theme'

type Screen = 'home' | 'record' | 'notes' | 'detail'

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [noteId, setNoteId] = useState<string | null>(null)
  useEffect(() => {
    readToken().then(async token => {
      if (!token) return setAuthenticated(false)
      try { await fetchMe(); setAuthenticated(true) } catch { await clearToken(); setAuthenticated(false) }
    })
  }, [])
  if (authenticated === null) return <SafeAreaProvider><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></SafeAreaProvider>
  const content = !authenticated ? <LoginScreen onAuthenticated={() => setAuthenticated(true)} /> : screen === 'home' ? <HomeScreen onRecord={() => setScreen('record')} onNotes={() => setScreen('notes')} onSignOut={async () => { await signOut(); setAuthenticated(false) }} /> : screen === 'record' ? <RecordScreen onDone={() => setScreen('notes')} onBack={() => setScreen('home')} /> : screen === 'notes' ? <NotesScreen onOpen={id => { setNoteId(id); setScreen('detail') }} onBack={() => setScreen('home')} /> : <NoteDetailScreen id={noteId!} onBack={() => setScreen('notes')} />
  return <SafeAreaProvider><StatusBar barStyle="dark-content" />{content}</SafeAreaProvider>
}
