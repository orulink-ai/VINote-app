import React, { useCallback, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { markdownPreview } from '../lib/markdown'
import { noteOrigin } from '../lib/noteOrigin'
import { Field } from '../components/Field'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'

export function NotesScreen({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setNotes(await listNotes()) }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败，请重试') }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { void load() }, [load])
  return <View style={styles.screen}>
    <View style={styles.content}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12} style={{ paddingVertical: 6 }}><Text style={styles.link}>‹ 首页</Text></Pressable>
      <View style={{ gap: 7, paddingTop: 10 }}><Text style={styles.title}>会议纪要</Text><Text style={styles.subtitle}>本机保存 · 暂不跨设备同步</Text></View>
      <Field label="搜索纪要" value={query} onChangeText={setQuery} placeholder="搜索标题或正文" />
    </View>
    <FlatList style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 28, gap: 10 }} data={notes.filter(note => (note.title + markdownPreview(note.content)).toLowerCase().includes(query.trim().toLowerCase()))} refreshing={loading} onRefresh={load} keyExtractor={item => item.id}
      ListHeaderComponent={error ? <View style={styles.card}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><PrimaryButton secondary title="重新加载" onPress={load} /></View> : undefined}
      ListEmptyComponent={!error ? <View style={[styles.card, { paddingVertical: 40 }]}><Text style={styles.noteTitle}>{loading ? '正在加载…' : query ? '没有找到匹配的纪要' : '还没有纪要'}</Text><Text style={styles.subtitle}>{query ? '试试其他关键词，或清空搜索。' : '在录音库中选择音频生成纪要。'}</Text></View> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`打开${item.title}`} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]} onPress={() => onOpen(item.id)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={styles.eyebrow}>{noteOrigin(item.generation_client)} · 版本 {item.version || 1}</Text><Text style={[styles.subtitle, { fontSize: 12 }]}>{new Date(item.created_at).toLocaleDateString('zh-CN')}</Text></View>
        <Text style={styles.noteTitle}>{item.title}</Text><Text numberOfLines={2} style={styles.subtitle}>{markdownPreview(item.content)}</Text>
        <Text style={[styles.link, { fontSize: 13, marginTop: 4 }]}>阅读纪要  →</Text>
      </Pressable>} />
  </View>
}
