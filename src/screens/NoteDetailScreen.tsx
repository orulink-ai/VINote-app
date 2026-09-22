import React, { useEffect, useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { styles } from '../design-system/theme'
import { getNote } from '../lib/notes'

export function NoteDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  useEffect(() => { getNote(id).then(note => { setTitle(note.title); setContent(note.content) }).catch(error => Alert.alert('加载失败', error instanceof Error ? error.message : '请稍后重试')) }, [id])
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><PrimaryButton secondary title="返回纪要列表" onPress={onBack} /><Text style={styles.title}>{title || '加载中…'}</Text><View style={styles.card}><Text style={styles.noteBody}>{content}</Text></View></ScrollView>
}
