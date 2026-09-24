import { unlinkRecordingNote } from '../features/recording/recordingLibrary'
import { noteOrigin } from '../lib/noteOrigin'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { RenameDialog } from '../components/RenameDialog'
import { MeetingMarkdown } from '../components/MeetingMarkdown'
import { colors, styles } from '../design-system/theme'
import { deleteNote, getNote, renameNote, shareNoteFile } from '../lib/notes'
import type { Note } from '../types/api'

export function NoteDetailScreen({ id, onBack, backLabel = '纪要列表' }: { id: string; onBack: () => void; backLabel?: string }) {
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setNote(null)
    getNote(id).then(value => { if (active) setNote(value) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '加载失败，请重试') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, attempt])
  const confirmDelete = () => Alert.alert('删除这份纪要？', `“${note?.title}”删除后无法恢复，这份纪要将从本机移除。此操作不会删除原始录音文件。`, [
    { text: '取消', style: 'cancel' },
    { text: '删除纪要', style: 'destructive', onPress: async () => {
      setDeleting(true)
      try { await deleteNote(id); try { await unlinkRecordingNote(id) } catch { Alert.alert('纪要已删除', '本机录音关联更新失败，再次查看时会自动检查。') } onBack() }
      catch (e) { Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试'); setDeleting(false) }
    } },
  ])
  return <View style={styles.screen}>
    <View style={{ paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" disabled={deleting} onPress={onBack} hitSlop={12}><Text style={styles.link}>‹ {backLabel}</Text></Pressable>
      {note && <Pressable accessibilityRole="button" accessibilityLabel="删除纪要" disabled={deleting} onPress={confirmDelete} hitSlop={12}><Text style={{ color: deleting ? colors.muted : colors.danger }}>{deleting ? '正在删除…' : '删除'}</Text></Pressable>}
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <View style={styles.card}><ActivityIndicator color={colors.primary} /><Text style={styles.subtitle}>正在加载纪要…</Text></View> : error ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.noteBody}>{error}</Text><PrimaryButton title="重新加载" onPress={() => setAttempt(value => value + 1)} /></View> : note ? <>
        <Text style={styles.title}>{note.title}</Text>
        <Pressable accessibilityRole="button" disabled={deleting} onPress={() => setRenaming(true)} hitSlop={12}><Text style={styles.link}>修改名称</Text></Pressable>
        <Text style={styles.subtitle}>版本 {note.version || 1} · {noteOrigin(note.generation_client)} · {new Date(note.created_at).toLocaleString('zh-CN')}</Text>
        <PrimaryButton secondary title="分享纪要文件" loading={sharing} disabled={deleting} onPress={async () => {
          setSharing(true)
          try { await shareNoteFile(note) }
          catch (e) { Alert.alert('分享失败', e instanceof Error ? e.message : '请稍后重试') }
          finally { setSharing(false) }
        }} />
        <View style={styles.card}>{note.content.trim() ? <MeetingMarkdown content={note.content} /> : <Text style={styles.subtitle}>这份纪要暂时没有正文。</Text>}</View>
      </> : null}
    </ScrollView>
    {renaming && note && <RenameDialog title={note.title} onClose={() => setRenaming(false)} onSave={async title => { setNote(await renameNote(id, title)) }} />}
  </View>
}
