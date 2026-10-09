import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, BackHandler, FlatList, Pressable, Text, View } from 'react-native'
import Sound from 'react-native-nitro-sound'
import { colors, styles } from '../design-system/theme'
import { PrimaryButton } from '../components/PrimaryButton'
import { RenameDialog } from '../components/RenameDialog'
import { CloudModelPicker } from '../components/CloudModelPicker'
import { deleteRecording, exportRecording, listRecordings, LocalRecording, renameRecording, importRecording } from '../features/recording/recordingLibrary'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'
import { generateRecording } from '../features/recording/generateRecording'
export function RecordingsScreen({ onBack, onOpenNote, initialGenerateId, initialImport = false }: { onBack: () => void; onOpenNote: (id: string) => void; initialGenerateId?: string | null; initialImport?: boolean }) {
  const [renaming, setRenaming] = useState<LocalRecording | null>(null)
  const [items, setItems] = useState<LocalRecording[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const [selected, setSelected] = useState<string | null>(initialGenerateId || null)
  const [modelsReady, setModelsReady] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [phase, setPhase] = useState('')
  const [importing, setImporting] = useState(false)
  const locked = useRef(false)
  const importTriggered = useRef(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const [recordings, savedNotes] = await Promise.all([listRecordings(), listNotes()]); setItems(recordings); setNotes(savedNotes) }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(); return () => { void Sound.stopPlayer().catch(() => {}); Sound.removePlayBackListener(); Sound.removePlaybackEndListener() } }, [load])
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load() }); return () => subscription.remove() }, [load])
  useEffect(() => {
    if (!items.some(item => item.generation?.status === 'pending')) return
    const timer = setInterval(() => { Promise.all([listRecordings(), listNotes()]).then(([recordings, savedNotes]) => { setItems(recordings); setNotes(savedNotes) }).catch(() => {}) }, 5000)
    return () => clearInterval(timer)
  }, [items])
  useEffect(() => { const handler = BackHandler.addEventListener('hardwareBackPress', () => {
    if (working || importing) Alert.alert('正在处理', '原音频已保留，请等待当前处理结束。')
    else onBack()
    return true
  }); return () => handler.remove() }, [working, importing, onBack])
  const action = async (record: LocalRecording, operation: () => Promise<unknown>) => {
    if (locked.current) return
    locked.current = true; setWorking(record.id)
    try { await operation() } catch (e) { Alert.alert('操作未完成', e instanceof Error ? e.message : '请重试') }
    finally { locked.current = false; setWorking(null); await load() }
  }
  const startImport = useCallback(() => {
    if (locked.current) return
    locked.current = true; setImporting(true)
    void (async () => {
      try {
        const record = await importRecording()
        if (record) Alert.alert('音频已保存', '原始音频已保存在本机。现在可以选择模型生成纪要，也可以稍后处理。', [
          { text: '仅保存音频' },
          { text: '生成会议纪要', onPress: () => { setModelsReady(false); setSelected(record.id) } },
        ])
      } catch (e) { Alert.alert('导入失败', e instanceof Error ? e.message : '请重新选择音频') }
      finally { locked.current = false; setImporting(false); await load() }
    })()
  }, [load])
  useEffect(() => {
    if (initialImport && !importTriggered.current) { importTriggered.current = true; startImport() }
  }, [initialImport, startImport])
  const play = async (record: LocalRecording) => {
    await Sound.stopPlayer(); Sound.removePlayBackListener(); Sound.removePlaybackEndListener()
    if (playing === record.id) { setPlaying(null); return }
    setPlaying(null); setPosition(0)
    await Sound.startPlayer(record.uri)
    setPlaying(record.id)
    Sound.addPlayBackListener(event => setPosition(Math.floor(event.currentPosition / 1000)))
    Sound.addPlaybackEndListener(() => { setPlaying(null); void Sound.stopPlayer().catch(() => {}) })
  }
  return <View style={styles.screen}>
    <View style={styles.content}><Pressable accessibilityRole="button" disabled={!!working || importing} onPress={onBack} style={{ paddingVertical: 6 }}><Text style={styles.link}>‹ 首页</Text></Pressable>
      <View style={{ gap: 7, paddingTop: 10 }}><Text style={styles.title}>录音库</Text><Text style={styles.subtitle}>原始音频保存在本机</Text></View>
      <PrimaryButton secondary title={importing ? '正在导入音频…' : '导入音频'} disabled={!!working || importing} onPress={startImport} />{error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}</View>
    <FlatList data={items} refreshing={loading} onRefresh={load} keyExtractor={item => item.id} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 28, gap: 12 }} ListEmptyComponent={<View style={[styles.card, { paddingVertical: 32 }]}><Text style={styles.noteTitle}>{loading ? '正在加载…' : '还没有录音'}</Text><Text style={styles.subtitle}>录制或导入的音频会显示在这里。</Text></View>} renderItem={({ item }) => <View style={styles.card}>
      <Text style={styles.eyebrow}>{item.source === 'import' ? '导入音频' : '会议录音'}</Text>
      <Text style={styles.noteTitle}>{item.title}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.duration ? Math.floor(item.duration / 60) + '分' + item.duration % 60 + '秒' : '时长待播放确认'}</Text>
      <View style={{ borderRadius: 12, backgroundColor: item.error ? colors.dangerSoft : colors.primarySoft, paddingHorizontal: 12, paddingVertical: 10 }}><Text style={{ color: item.error ? colors.danger : colors.muted, fontSize: 13, lineHeight: 19 }}>{working === item.id ? phase || '正在处理…' : item.generation?.status === 'pending' ? item.error ? `暂时中断：${item.error}；回到 App 后继续` : '生成任务已保存，正在继续或等待 App 恢复' : item.error ? '处理失败：' + item.error : notes.some(note => note.task_id === item.id) ? '纪要已生成 · 原音频已保留' : '原音频已保存在本机'}</Text></View>
      {notes.filter(note => note.task_id === item.id).sort((a, b) => (a.version || 1) - (b.version || 1)).map(note =>
        <PrimaryButton key={note.id} secondary title={`查看版本 ${note.version || 1}`} disabled={!!working || importing} onPress={() => onOpenNote(note.id)} />)}
      {selected === item.id ? <View style={{ gap: 12 }}>
        <CloudModelPicker disabled={!!working || importing} onReady={setModelsReady} />
        <PrimaryButton title={working === item.id ? phase : item.generation?.status === 'paused' ? `重试生成版本 ${item.generation.version || 1}` : `生成版本 ${Math.max(item.lastNoteVersion || 0, ...notes.filter(note => note.task_id === item.id).map(note => note.version || 1)) + 1}`} loading={working === item.id} disabled={!!working || importing || !modelsReady} onPress={() => { void action(item, async () => { await Sound.stopPlayer(); setPlaying(null); await generateRecording(item, setPhase); setSelected(null) }) }} />
        <PrimaryButton secondary title="取消" disabled={!!working || importing} onPress={() => setSelected(null)} />
      </View> : <PrimaryButton title={item.generation?.status === 'paused' ? '重试生成纪要' : notes.some(note => note.task_id === item.id) ? '再生成一版' : '生成会议纪要'} disabled={!!working || importing || (item.generation?.status === 'pending' && !item.error)} onPress={() => { setModelsReady(false); setSelected(item.id) }} />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <PrimaryButton secondary style={{ flex: 1 }} title={playing === item.id ? '停止 · ' + position + 's' : '播放原声'} disabled={!!working || importing} onPress={() => { setPhase('正在打开音频…'); void action(item, () => play(item)) }} />
        <PrimaryButton secondary style={{ flex: 1 }} title="导出原音频" disabled={!!working || importing} onPress={() => { setPhase('正在导出…'); void action(item, () => exportRecording(item)) }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 }}>
        <Pressable accessibilityRole="button" disabled={!!working || importing || item.generation?.status === 'pending'} hitSlop={10} onPress={() => setRenaming(item)}><Text style={styles.link}>修改名称</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!!working || importing || item.generation?.status === 'pending'} hitSlop={10} onPress={() => Alert.alert('删除本机录音？', '原音频删除后无法恢复，已经保存的会议纪要不受影响。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { setPhase('正在删除…'); void action(item, async () => { if (playing === item.id) { await Sound.stopPlayer(); setPlaying(null) } await deleteRecording(item) }) } }])}><Text style={[styles.link, { color: colors.danger }]}>删除录音</Text></Pressable>
      </View>
    </View>} />
    {renaming && <RenameDialog title={renaming.title} onClose={() => setRenaming(null)} onSave={async title => { await renameRecording(renaming, title); await load() }} />}
  </View>
}
