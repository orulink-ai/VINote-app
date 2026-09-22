import React, { useCallback, useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { styles } from '../design-system/theme'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'

export function NotesScreen({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => { try { setLoading(true); setNotes(await listNotes()) } catch (error) { Alert.alert('加载失败', error instanceof Error ? error.message : '请稍后重试') } finally { setLoading(false) } }, [])
  React.useEffect(() => { load() }, [load])
  return <View style={styles.screen}><View style={styles.content}><Text style={styles.title}>会议纪要</Text><PrimaryBack onPress={onBack} /><FlatList data={notes} refreshing={loading} onRefresh={load} keyExtractor={item => item.id} ListEmptyComponent={<Text style={styles.subtitle}>{loading ? '正在加载…' : '还没有会议纪要，先去录一场会议吧。'}</Text>} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => onOpen(item.id)}><Text style={styles.noteTitle}>{item.title}</Text><Text style={styles.subtitle}>{new Date(item.created_at).toLocaleString('zh-CN')}</Text><Text numberOfLines={2} style={styles.subtitle}>{item.content}</Text></Pressable>} /></View></View>
}
function PrimaryBack({ onPress }: { onPress: () => void }) { return <PrimaryButtonShim title="返回首页" onPress={onPress} /> }
function PrimaryButtonShim({ title, onPress }: { title: string; onPress: () => void }) { return <Pressable onPress={onPress}><Text style={styles.link}>{title}</Text></Pressable> }
