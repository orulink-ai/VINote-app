import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { BrandMark } from '../components/BrandMark'
import { colors, styles } from '../design-system/theme'
import { listRecordings, type LocalRecording } from '../features/recording/recordingLibrary'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'

type Props = {
  libraryRevision?: number
  onRecord: () => void
  onImport: () => void
  onRecordings: () => void
  onNotes: () => void
  onOpenNote: (id: string) => void
  onSignOut: () => void
}

function SectionHeader({ title, onPress }: { title: string; onPress: () => void }) {
  return <View style={local.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`查看全部${title}`} onPress={onPress} hitSlop={8} style={local.textAction}>
      <Text style={styles.link}>查看全部  ›</Text>
    </Pressable>
  </View>
}

export function HomeScreen({ libraryRevision = 0, onRecord, onImport, onRecordings, onNotes, onOpenNote, onSignOut }: Props) {
  const [recordings, setRecordings] = useState<LocalRecording[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [recordingsError, setRecordingsError] = useState(false)
  const [notesError, setNotesError] = useState(false)

  useEffect(() => {
    let active = true
    Promise.allSettled([listRecordings(), listNotes()]).then(([recordingsResult, notesResult]) => {
      if (!active) return
      if (recordingsResult.status === 'fulfilled') setRecordings(recordingsResult.value)
      setRecordingsError(recordingsResult.status !== 'fulfilled')
      if (notesResult.status === 'fulfilled') setNotes(notesResult.value)
      setNotesError(notesResult.status !== 'fulfilled')
      setLoading(false)
    })
    return () => { active = false }
  }, [libraryRevision])

  const latestRecording = recordings[0]
  const latestNote = notes[0]
  return <ScrollView style={styles.screen} contentContainerStyle={local.content}>
    <View style={local.topBar}>
      <View style={local.brand}><BrandMark size={34} /><Text style={local.brandName}>VINote</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="退出登录" onPress={onSignOut} hitSlop={10} style={local.signOut}><Text style={styles.subtitle}>退出</Text></Pressable>
    </View>

    <Text style={styles.title}>首页</Text>
    <View style={local.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="开始录音" onPress={onRecord}
        style={({ pressed }) => [local.recordAction, pressed && local.recordActionPressed]}>
        <View style={local.recordIcon}><View style={local.recordDot} /></View>
        <View style={local.actionText}><Text style={local.recordTitle}>开始录音</Text><Text style={local.recordHint}>原声先保存在本机</Text></View>
        <Text style={local.recordArrow}>›</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="导入音频" onPress={onImport}
        style={({ pressed }) => [local.importAction, pressed && local.importActionPressed]}>
        <View style={local.importIcon}><Text style={local.plus}>＋</Text></View>
        <Text style={[styles.noteTitle, local.actionText]}>导入音频</Text><Text style={local.arrow}>›</Text>
      </Pressable>
    </View>

    <View style={local.section}>
      <SectionHeader title="录音" onPress={onRecordings} />
      {loading ? <ActivityIndicator color={colors.muted} style={local.loading} /> : recordingsError ?
        <Pressable accessibilityRole="button" accessibilityLabel="打开录音库" onPress={onRecordings} style={local.empty}><Text style={styles.subtitle}>本机录音暂时无法读取，打开录音库重试。</Text></Pressable> : latestRecording ?
        <Pressable accessibilityRole="button" accessibilityLabel={`打开录音：${latestRecording.title}`} onPress={onRecordings} style={({ pressed }) => [local.item, pressed && local.itemPressed]}>
          <View style={local.itemText}><Text style={styles.noteTitle} numberOfLines={1}>{latestRecording.title}</Text>
            <Text style={styles.subtitle}>{latestRecording.error ? '需要检查' : latestRecording.generation?.status === 'pending' ? '正在生成' : new Date(latestRecording.createdAt).toLocaleDateString('zh-CN')}</Text></View>
          <Text style={local.arrow}>›</Text>
        </Pressable> : <View style={local.empty}><Text style={styles.subtitle}>还没有录音</Text></View>}
    </View>

    <View style={local.section}>
      <SectionHeader title="纪要" onPress={onNotes} />
      {loading ? <ActivityIndicator color={colors.muted} style={local.loading} /> : notesError ?
        <Pressable accessibilityRole="button" accessibilityLabel="打开纪要列表" onPress={onNotes} style={local.empty}><Text style={styles.subtitle}>本机纪要暂时无法读取，打开纪要列表重试。</Text></Pressable> : latestNote ?
        <Pressable accessibilityRole="button" accessibilityLabel={`打开纪要：${latestNote.title}`} onPress={() => onOpenNote(latestNote.id)} style={({ pressed }) => [local.item, pressed && local.itemPressed]}>
          <View style={local.itemText}><Text style={styles.noteTitle} numberOfLines={1}>{latestNote.title}</Text>
            <Text style={styles.subtitle}>{new Date(latestNote.created_at).toLocaleDateString('zh-CN')} · 版本 {latestNote.version || 1}</Text></View>
          <Text style={local.arrow}>›</Text>
        </Pressable> : <View style={local.empty}><Text style={styles.subtitle}>还没有纪要</Text></View>}
    </View>
  </ScrollView>
}

const local = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 36, gap: 30 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 19, fontWeight: '700', letterSpacing: -0.5 },
  signOut: { minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 10, marginTop: -12 },
  recordAction: { minHeight: 104, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 16 },
  recordActionPressed: { backgroundColor: '#303035' },
  recordIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#3F3F46', alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },
  actionText: { flex: 1 },
  recordTitle: { color: '#FFFFFF', fontFamily: 'sans-serif', fontSize: 20, fontWeight: '700' },
  recordHint: { color: '#D4D4D8', fontFamily: 'sans-serif', fontSize: 13, marginTop: 4 },
  recordArrow: { color: '#FFFFFF', fontSize: 28 },
  importAction: { minHeight: 64, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center', gap: 12 },
  importActionPressed: { backgroundColor: colors.primarySoft },
  importIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  plus: { color: colors.ink, fontSize: 23, lineHeight: 27 },
  arrow: { color: colors.muted, fontSize: 25 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 },
  textAction: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  item: { minHeight: 76, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemPressed: { backgroundColor: colors.primarySoft },
  itemText: { flex: 1, gap: 4 },
  empty: { minHeight: 68, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  loading: { minHeight: 68 },
})
