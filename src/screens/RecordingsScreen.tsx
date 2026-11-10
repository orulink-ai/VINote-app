import { recordingASRBlocked, RECORDING_ASR_BLOCKED } from '../lib/recordingASRSafety'
import { isRecordingActive } from '../features/recording/recordingService'
import { Text } from '../components/AppText'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  BackHandler,
  FlatList,
  Pressable,
  View,
} from 'react-native'
import Sound from 'react-native-nitro-sound'
import { colors, styles } from '../design-system/theme'
import { PrimaryButton } from '../components/PrimaryButton'
import { Field } from '../components/Field'
import { RecordingProcessingStatus } from '../components/RecordingProcessingStatus'
import { DetailDisclosure } from '../components/DetailDisclosure'
import { sourceRecoveryCopy } from '../lib/sourceRecoveryCopy'
import { RenameDialog } from '../components/RenameDialog'
import { CloudModelPicker } from '../components/CloudModelPicker'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { ScreenHeader } from '../components/ScreenHeader'
import { BottomActionSheet } from '../components/BottomActionSheet'
import {
  deleteRecording,
  exportRecording,
  listRecordings,
  LocalRecording,
  renameRecording,
  importRecording,
} from '../features/recording/recordingLibrary'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'
import { generateRecording } from '../features/recording/generateRecording'
import { generateRecordingSummary } from '../features/recording/generateRecording'
import { restartMissingMeetingJob } from '../features/recording/restartMissingMeetingJob'
import { RecordingSummaryRecovery } from '../components/RecordingSummaryRecovery'
import { readAccountId } from '../lib/storage'
import { identityEpoch, SessionScopeChangedError } from '../lib/sessionIdentity'
import { useRecordingProgress } from '../features/recording/useRecordingProgress'
import { displayRecordingTitle, meetingDisplayName, recordingDisplayName } from '../features/recording/recordingTitle'
export function RecordingsScreen({
  onBack,
  backLabel = '返回工作台',
  onOpenNote,
  initialGenerateId,
  initialImport = false,
  initialFocusId,
  home = false,
  onRecord,
}: {
  onBack: () => void
  backLabel?: string
  onOpenNote: (id: string, recordingId?: string) => void
  initialGenerateId?: string | null
  initialImport?: boolean
  initialFocusId?: string | null
  home?: boolean
  onRecord?: () => void
}) {
  const activeProgress = useRecordingProgress()
  const [focusedId, setFocusedId] = useState(initialFocusId)
  const focusContext = useRef({ id: focusedId, epoch: 0 })
  if (focusContext.current.id !== focusedId) focusContext.current = { id: focusedId, epoch: focusContext.current.epoch + 1 }
  const [exportFeedback, setExportFeedback] = useState<{ id: string; uri: string; view: number; message: string } | null>(null)
  useEffect(() => { setExportFeedback(null) }, [focusedId])
  const [renaming, setRenaming] = useState<LocalRecording | null>(null)
  const [items, setItems] = useState<LocalRecording[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [notesReading, setNotesReading] = useState(true)
  const [notesReady, setNotesReady] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const playerRecord = useRef<string | null>(null)
  const [seekWidth, setSeekWidth] = useState(1)
  const [selected, setSelected] = useState<string | null>(
    initialGenerateId || null,
  )
  const [modelsReady, setModelsReady] = useState(false)
  const [summaryOnly, setSummaryOnly] = useState(false)
  useEffect(() => { setSummaryOnly(false) }, [selected])
  const [working, setWorking] = useState<string | null>(null)
  const [workingKind, setWorkingKind] = useState<'generation' | 'page' | null>(null)
  const mounted = useRef(true)
  const scopeEpoch = useRef(identityEpoch())
  const uiCurrent = useCallback(() => mounted.current && identityEpoch() === scopeEpoch.current, [])
  const [phase, setPhase] = useState('')
  const [importing, setImporting] = useState(false)
  const readEpoch = useRef(0)
  const listOffset = useRef(0)
  const listRef = useRef<FlatList<LocalRecording>>(null)
  const locked = useRef(false)
  const importTriggered = useRef(false)
  const load = useCallback(async () => {
    if (!uiCurrent()) return
    const run = ++readEpoch.current
    setLoading(true)
    setNotesReading(true)
    setError('')
    const current = () => uiCurrent() && readEpoch.current === run
    await Promise.allSettled([
      listRecordings().then(recordings => { if (current()) setItems(recordings) }).catch(() => {
        if (current()) setError(value => [value, '录音读取未完成，已读取的原录音仍可使用，请重试。'].filter(Boolean).join('\n'))
      }).finally(() => { if (current()) setLoading(false) }),
      listNotes().then(savedNotes => { if (current()) { setNotes(savedNotes); setNotesReady(true) } }).catch(() => {
        if (current()) { setNotesReady(false); setError(value => [value, '纪要状态暂未读取，原录音仍可播放和导出，请重试。'].filter(Boolean).join('\n')) }
      }).finally(() => { if (current()) setNotesReading(false) }),
    ])
  }, [uiCurrent])
  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      playerRecord.current = null
      readEpoch.current++
      void Sound.stopPlayer().catch(() => {})
      Sound.removePlayBackListener()
      Sound.removePlaybackEndListener()
    }
  }, [load])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void load()
    })
    return () => subscription.remove()
  }, [load])
  useEffect(() => {
    if (!items.some(item => item.generation?.status === 'pending')) return
    let active = true
    let reading = false
    const timer = setInterval(() => {
      if (!active || !uiCurrent() || reading) return
      reading = true
      const run = readEpoch.current
      Promise.all([listRecordings(), listNotes()])
        .then(([recordings, savedNotes]) => {
          if (!active || !uiCurrent() || run !== readEpoch.current) return
          setItems(recordings)
          setNotes(savedNotes)
        })
        .catch(() => {})
        .finally(() => { reading = false })
    }, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [items, uiCurrent])
  const goBack = useCallback(() => {
    if (!uiCurrent()) return
    if (focusedId && !initialFocusId) {
      setFocusedId(null)
      setPlaying(null)
      playerRecord.current = null
      void Sound.stopPlayer().catch(() => {})
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: listOffset.current, animated: false }))
    } else onBack()
  }, [focusedId, initialFocusId, onBack, uiCurrent])
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (importing || (working && workingKind !== 'generation' && (!focusedId || initialFocusId)))
        Alert.alert('正在处理', '原音频已保留，请等待当前处理结束。')
      else goBack()
      return true
    })
    return () => handler.remove()
  }, [working, workingKind, importing, focusedId, initialFocusId, goBack])
  const action = async (
    record: LocalRecording,
    operation: () => Promise<unknown>,
    kind: 'generation' | 'page' = 'page',
  ) => {
    if (!uiCurrent() || locked.current) return
    const view = focusContext.current.epoch
    const current = () => uiCurrent() && focusContext.current.epoch === view
    locked.current = true
    setWorking(record.id)
    setWorkingKind(kind)
    try {
      await operation()
    } catch (e) {
      if (current()) Alert.alert('操作未完成', e instanceof Error ? e.message : '请重试')
    } finally {
      locked.current = false
      if (uiCurrent()) {
        setWorking(null)
        setWorkingKind(null)
        setPhase('')
        await load()
      }
    }
  }
  const startImport = useCallback(() => {
    if (!uiCurrent() || locked.current) return
    locked.current = true
    setImporting(true)
    void (async () => {
      try {
        const record = await importRecording()
        if (record && uiCurrent())
          Alert.alert(
            '音频已保存',
            '录音已保存。现在生成会议纪要，也可以稍后处理。',
            [
              { text: '仅保存音频' },
              {
                text: '生成会议纪要',
                onPress: () => {
                  if (!uiCurrent()) return
                  setModelsReady(false)
                  setSelected(record.id)
                },
              },
            ],
          )
      } catch (e) {
        if (uiCurrent()) Alert.alert(
          '导入失败',
          e instanceof Error ? e.message : '请重新选择音频',
        )
      } finally {
        locked.current = false
        if (uiCurrent()) { setImporting(false); await load() }
      }
    })()
  }, [load, uiCurrent])
  useEffect(() => {
    if (initialImport && !importTriggered.current) {
      importTriggered.current = true
      startImport()
    }
  }, [initialImport, startImport])
  const play = async (record: LocalRecording, seconds?: number) => {
    if (isRecordingActive()) throw new Error('请先结束当前录音，再播放原声')
    if (playing === record.id && seconds === undefined) {
      await Sound.pausePlayer()
      setPlaying(null)
      return
    }
    if (playerRecord.current !== record.id) {
      await Sound.stopPlayer()
      Sound.removePlayBackListener()
      Sound.removePlaybackEndListener()
      playerRecord.current = null
      setPosition(0)
      await Sound.startPlayer(record.uri)
      playerRecord.current = record.id
      Sound.addPlayBackListener(event => setPosition(Math.floor(event.currentPosition / 1000)))
      Sound.addPlaybackEndListener(() => {
        playerRecord.current = null
        setPlaying(null)
        setPosition(0)
        void Sound.stopPlayer().catch(() => {})
      })
    } else if (playing !== record.id) {
      await Sound.resumePlayer()
    }
    if (seconds !== undefined) await Sound.seekToPlayer(Math.max(0, Math.min(record.duration, seconds)) * 1000)
    setPlaying(record.id)
  }
  const selectedRecord = items.find(item => item.id === selected)
  const filteredItems = home && query.trim() ? items.filter(item => `${recordingDisplayName(item)} ${item.title} ${notes.filter(note => note.task_id === item.id).map(note => `${note.title} ${note.content || ''}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())) : items
  const dateLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '录制日期未记录' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) }
  return (
    <View style={styles.screen}>
      <ScreenHeader title={focusedId ? '会议详情' : home ? '会议' : '录音库'} onBack={home && !focusedId ? undefined : goBack} backLabel={focusedId && !initialFocusId ? (home ? '返回会议' : '返回录音库') : backLabel} disabled={importing || (!!working && workingKind !== 'generation' && (!focusedId || !!initialFocusId))} />
      <View style={[styles.content, { paddingBottom: home && !focusedId ? 4 : 12, gap: home && !focusedId ? 8 : 14 }]}>
        {(!home || focusedId) && <View style={{ gap: 7, paddingTop: 10 }}>
          <Text style={styles.subtitle}>{focusedId ? '查看录音、处理状态与关联纪要。' : '查看录音、处理状态与相关纪要。'}</Text>
        </View>}
        {home && !focusedId && <><View style={{ flexDirection: 'row', gap: 10 }}>{onRecord && <PrimaryButton title="录制会议" icon={<WorkspaceIcon name="microphone" color={colors.onPrimary} />} onPress={onRecord} disabled={importing} style={{ flex: 1, borderRadius: 12 }} />}<PrimaryButton secondary title={importing ? '导入中…' : '导入音频'} icon={<WorkspaceIcon name="upload" color={colors.navigationAccent} />} disabled={!!working || importing} onPress={startImport} style={{ flex: 1, borderRadius: 12 }} /></View><Field search hideLabel label="搜索会议" value={query} onChangeText={setQuery} placeholder="搜索会议或纪要" style={{ backgroundColor: colors.card, borderWidth: 0, borderRadius: 12, minHeight: 44 }} /></>}
        {!home && !focusedId && <PrimaryButton
          secondary
          title={importing ? '正在导入音频…' : '导入音频'}
          disabled={!!working || importing}
          onPress={startImport}
        />}
        {error ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {error}
            </Text>
            <PrimaryButton
              secondary
              title="重新加载录音"
              disabled={loading || !!working || importing}
              onPress={load}
            />
          </View>
        ) : null}
      </View>
      <FlatList
        ref={listRef}
        onScroll={event => { if (!focusedId) listOffset.current = event.nativeEvent.contentOffset.y }}
        scrollEventThrottle={100}
        data={focusedId ? items.filter(item => item.id === focusedId) : filteredItems}
        refreshing={loading}
        onRefresh={load}
        keyExtractor={item => item.id}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingBottom: 28,
          gap: home && !focusedId ? 0 : 8,
        }}
        ListFooterComponent={home && !focusedId && notesReady ? <View style={{ gap: 8, paddingTop: 12 }}>{notes.filter(note => (note.source_type || '').startsWith('meeting') && !items.some(item => item.id === note.task_id) && `${note.title} ${note.content || ''}`.toLowerCase().includes(query.trim().toLowerCase())).length > 0 && <><Text style={styles.sectionTitle}>未关联录音的纪要</Text>{notes.filter(note => (note.source_type || '').startsWith('meeting') && !items.some(item => item.id === note.task_id) && `${note.title} ${note.content || ''}`.toLowerCase().includes(query.trim().toLowerCase())).map(note => <Pressable key={note.id} accessibilityRole="button" accessibilityLabel={`打开未关联录音的纪要 ${note.title}`} onPress={() => onOpenNote(note.id)} style={styles.listRow}><Text style={styles.noteTitle}>{note.title}</Text><Text style={styles.subtitle}>未找到此设备上的关联录音</Text></Pressable>)}</>}</View> : undefined}
        ListEmptyComponent={!error ?
          <View style={[styles.emptyState]}>
            <Text style={styles.noteTitle}>
              {loading ? '正在读取录音…' : focusedId ? '该原录音已不可用' : query.trim() ? '没有找到匹配的会议' : '还没有录音'}
            </Text>
            <Text style={styles.subtitle}>{loading ? '正在读取此设备保存的原录音。' : focusedId ? '可能已在此设备删除，请返回查看会议和回收站。' : '录制或导入的音频会显示在这里。'}</Text>
          </View> : undefined
        }
        renderItem={({ item, index }) => !focusedId ? (
          <>
          {home && (index === 0 || dateLabel(filteredItems[index - 1].createdAt) !== dateLabel(item.createdAt)) && <Text style={[styles.subtitle, { paddingTop: 22, paddingBottom: 8, fontWeight: '500' }]}>{dateLabel(item.createdAt)}</Text>}
          <View style={[styles.listRow, home && { borderWidth: 0, borderBottomWidth: index === filteredItems.length - 1 || dateLabel(filteredItems[index + 1].createdAt) !== dateLabel(item.createdAt) ? 0 : 1, borderColor: colors.line, borderRadius: 0, borderTopLeftRadius: index === 0 || dateLabel(filteredItems[index - 1].createdAt) !== dateLabel(item.createdAt) ? 14 : 0, borderTopRightRadius: index === 0 || dateLabel(filteredItems[index - 1].createdAt) !== dateLabel(item.createdAt) ? 14 : 0, borderBottomLeftRadius: index === filteredItems.length - 1 || dateLabel(filteredItems[index + 1].createdAt) !== dateLabel(item.createdAt) ? 14 : 0, borderBottomRightRadius: index === filteredItems.length - 1 || dateLabel(filteredItems[index + 1].createdAt) !== dateLabel(item.createdAt) ? 14 : 0, paddingHorizontal: 14, paddingVertical: 14 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`打开原录音${recordingDisplayName(item)}`} disabled={importing} onPress={() => setFocusedId(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' }}><WorkspaceIcon name="record" muted /></View>
              <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={2} style={styles.noteTitle}>{home ? meetingDisplayName(item, notes.find(note => note.task_id === item.id)?.title) : recordingDisplayName(item)}</Text><Text style={styles.subtitle}>{item.source === 'import' ? '导入于 ' : '录制于 '}{Number.isNaN(new Date(item.createdAt).getTime()) ? '时间未记录' : new Date(item.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', ...(home ? {} : { year: 'numeric', month: 'numeric', day: 'numeric' }) })} · {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')} · {activeProgress?.recordId === item.id || working === item.id ? '处理中' : item.error ? '需处理' : item.generation ? '处理中' : notesReading ? '正在核对纪要' : !notesReady ? '纪要状态待核对' : notes.some(note => note.task_id === item.id) ? `${notes.filter(note => note.task_id === item.id).length} 份纪要` : '未生成'}</Text></View><Text style={[styles.subtitle, { fontSize: 20 }]}>›</Text>
            </Pressable>
            {item.error && <Text accessibilityRole="alert" numberOfLines={2} style={{ color: colors.danger }}>{sourceRecoveryCopy(item.error)}</Text>}
            {activeProgress?.recordId === item.id && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{activeProgress.text.split('\n')[0].replace(/^转写：/, '')}</Text>}
            {!home && <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>{working === item.id || activeProgress?.recordId === item.id ? <PrimaryButton tertiary title="查看进度" onPress={() => setFocusedId(item.id)} /> : <PrimaryButton tertiary title={notesReading ? '正在核对纪要…' : !notesReady ? '纪要状态待核对' : item.generation?.status === 'pending' ? '继续处理' : item.generation?.status === 'paused' ? '重试生成纪要' : notes.some(note => note.task_id === item.id) ? '再生成一版' : '生成会议纪要'} disabled={notesReading || !notesReady || !!working || !!activeProgress || importing} onPress={() => { setModelsReady(false); setSelected(item.id) }} />}</View>}
          </View>
          </>
        ) : (
          <View style={styles.listRow}>
            <Text style={styles.subtitle}>录音</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={[styles.noteTitle, { flex: 1, fontSize: 15, lineHeight: 22 }]}>{recordingDisplayName(item)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="修改录音名称" disabled={!!working || !!activeProgress || importing || item.generation?.status === 'pending'} onPress={() => setRenaming(item)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={styles.link}>修改</Text></Pressable>
            </View>
            <Text style={styles.subtitle}>{item.source === 'import' ? '导入于 ' : '录制于 '}{Number.isNaN(new Date(item.createdAt).getTime()) ? '时间未记录' : new Date(item.createdAt).toLocaleString('zh-CN')} · {Math.floor(item.duration / 60)}分{Math.floor(item.duration % 60)}秒</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={playing === item.id ? '暂停播放录音' : '播放原声'} disabled={!!working || importing} onPress={() => { setPhase('正在打开音频…'); void action(item, () => play(item)) }} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.primarySoft : colors.canvas, opacity: !!working || importing ? 0.5 : 1 })}>
                <Text style={{ color: colors.navigationAccent, fontSize: 16 }}>{playing === item.id ? 'Ⅱ' : '▶'}</Text>
              </Pressable>
              <Pressable accessibilityRole="adjustable" accessibilityLabel="录音播放进度" accessibilityValue={{ min: 0, max: item.duration || 0, now: Math.min(position, item.duration || 0) }} accessibilityActions={[{ name: 'increment', label: '前进十秒' }, { name: 'decrement', label: '后退十秒' }]} disabled={!item.duration || !!working || importing} onAccessibilityAction={event => void action(item, () => play(item, position + (event.nativeEvent.actionName === 'increment' ? 10 : -10)))} onLayout={event => setSeekWidth(Math.max(1, event.nativeEvent.layout.width))} onPress={event => void action(item, () => play(item, Math.max(0, Math.min(item.duration, event.nativeEvent.locationX / seekWidth * item.duration))))} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.line }}><View style={{ height: 3, borderRadius: 2, backgroundColor: colors.navigationAccent, width: `${Math.min(100, item.duration ? position / item.duration * 100 : 0)}%` }} /></View>
              </Pressable>
              <Text style={styles.subtitle}>{Math.floor(position / 60)}:{String(position % 60).padStart(2, '0')} / {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')}</Text>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4, paddingTop: 12, gap: 6 }}>
            <Text accessibilityRole="header" style={styles.noteTitle}>会议纪要</Text>
            <RecordingProcessingStatus key={item.id} record={item} progress={activeProgress?.recordId === item.id ? activeProgress : null}
              working={working === item.id} phase={working === item.id ? phase : ''} noteSaved={notesReady && notes.some(note => note.task_id === item.id)} notesReading={notesReading} notesReady={notesReady} compact={notesReady && notes.some(note => note.task_id === item.id) && !item.error && !item.generation && working !== item.id && activeProgress?.recordId !== item.id}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {notes
              .filter(note => note.task_id === item.id)
              .sort((a, b) => (a.version || 1) - (b.version || 1))
              .map(note => (
                <Pressable key={note.id} accessibilityRole="button" accessibilityLabel={`查看版本 ${note.version || 1}`} disabled={!!working || importing} onPress={() => onOpenNote(note.id, item.id)} style={({ pressed }) => ({ minHeight: 48, flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? colors.primarySoft : colors.canvas })}>
                  <WorkspaceIcon name="content" color={colors.navigationAccent} />
                  <View style={{ flex: 1, gap: 2 }}><Text style={[styles.label, { marginBottom: 0 }]} numberOfLines={2}>{displayRecordingTitle(note.title)}</Text>{notes.filter(value => value.task_id === item.id).length > 1 && <Text style={styles.subtitle}>版本 {note.version || 1}</Text>}</View>
                  <Text style={styles.subtitle}>›</Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              tertiary={notesReady && notes.some(note => note.task_id === item.id)}
              style={notesReady && notes.some(note => note.task_id === item.id) ? { alignSelf: 'flex-end' } : undefined}
              title={notesReading ? '正在核对纪要…' : !notesReady ? '纪要状态待核对' : working === item.id ? '正在处理…' : item.generation?.status === 'pending' ? '继续处理' : item.generation?.status === 'paused' ? '重试生成纪要' : notes.some(note => note.task_id === item.id) ? '再生成一版' : '生成会议纪要'}
              disabled={notesReading || !notesReady || !!working || !!activeProgress || importing}
              onPress={() => { setModelsReady(false); setSelected(item.id) }}
            />
            </RecordingProcessingStatus>
            </View>
            <DetailDisclosure key={`source-${item.id}`} title="录音管理">
              <Text style={styles.subtitle}>{item.source === 'import' ? '导入音频' : '会议录音'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
              {item.source === 'import' && !!item.originalName && <Text style={styles.subtitle}>原文件名：{item.originalName}</Text>}
              <Text style={styles.subtitle}>{item.duration ? `${Math.floor(item.duration / 60)}分${Math.floor(item.duration % 60)}秒` : '时长待播放确认'} · 原音频保留在此设备</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton
                secondary
                style={{ flex: 1 }}
                title="导出原音频"
                disabled={!!working || importing}
                onPress={() => {
                  void action(item, async () => {
                    const view = focusContext.current.epoch
                    setExportFeedback(null); setPhase('正在导出…')
                    const result = await exportRecording(item)
                    if (uiCurrent() && focusContext.current.epoch === view && focusContext.current.id === item.id) {
                      setExportFeedback({ id: item.id, uri: item.uri, view, message: result === 'saved' ? '原音频已保存到所选位置。' : '已取消导出，原音频保留。' })
                    }
                  })
                }}
              />
            </View>
            {exportFeedback?.id === item.id && exportFeedback.uri === item.uri && exportFeedback.view === focusContext.current.epoch && uiCurrent() && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{exportFeedback.message}</Text>}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingTop: 2,
              }}
            >
              <Pressable
                accessibilityRole="button"
                disabled={
                  !!working ||
                  !!activeProgress ||
                  importing ||
                  item.generation?.status === 'pending'
                }
                hitSlop={10}
                onPress={() =>
                  Alert.alert(
                    '删除整个会议？',
                    '原录音会永久删除，关联的会议纪要会移入回收站。此操作无法恢复原录音。',
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: () => {
                          setPhase('正在删除…')
                          void action(item, async () => {
                            if (playing === item.id) {
                              await Sound.stopPlayer()
                              setPlaying(null)
                            }
                            await deleteRecording(item)
                            if (uiCurrent()) goBack()
                          })
                        },
                      },
                    ],
                  )
                }
              >
                <Text style={[styles.link, { color: colors.danger }]}>
                  删除会议及原录音
                </Text>
              </Pressable>
            </View>
            </DetailDisclosure>
            {notesReady && notes.some(note => note.task_id === item.id) && !item.error && !item.generation && working !== item.id && activeProgress?.recordId !== item.id && <DetailDisclosure title="处理详情"><RecordingProcessingStatus record={item} progress={null} working={false} phase="" noteSaved notesReading={false} /></DetailDisclosure>}
          </View>
        )}
      />
      <BottomActionSheet visible={!!selectedRecord} title={summaryOnly ? '更换总结模型，仅生成纪要' : selectedRecord?.generation?.status === 'paused' ? '重试生成纪要' : selectedRecord?.generation ? '继续处理' : '生成会议纪要'} onBack={summaryOnly ? () => setSummaryOnly(false) : undefined} onClose={() => { if (!working && !importing) setSelected(null) }}>
        {selectedRecord && <>
          <Text style={styles.noteTitle}>{selectedRecord.title}</Text>
          {summaryOnly ? <RecordingSummaryRecovery recordId={selectedRecord.id} disabled={!!working || !!activeProgress || importing || notesReading || !notesReady}
            onCancel={() => setSelected(null)} onConfirm={confirmation => {
              if (!uiCurrent() || locked.current || activeProgress || importing || notesReading || !notesReady) return
              const record = selectedRecord
              setSelected(null)
              void action(record, async () => {
                if (identityEpoch() !== confirmation.epoch || await readAccountId() !== confirmation.owner) throw new SessionScopeChangedError()
                await Sound.stopPlayer()
                if (uiCurrent()) setPlaying(null)
                await generateRecordingSummary(confirmation, text => { if (uiCurrent()) setPhase(text) })
              }, 'generation')
            }} /> : <>
          <DetailDisclosure key={selected} title="处理说明"><Text style={styles.subtitle}>{selectedRecord.errorDetails?.status === 404 && selectedRecord.errorDetails.code === 'transcription_job_not_found' ? '原任务尚未找到。重新提交前会再次查询，并保留原任务记录和音频。' : '录音和已有纪要继续保留；处理会沿用已确认的进度。'}</Text></DetailDisclosure>
          {notesReading && <Text style={styles.subtitle}>正在核对已有纪要与版本…</Text>}
          {!notesReading && !notesReady && <><Text accessibilityRole="alert" style={styles.subtitle}>纪要状态暂未读取，先重新核对再生成；原录音保留。</Text><PrimaryButton secondary title="重新核对纪要" onPress={() => { void load() }} /></>}
          {recordingASRBlocked(selectedRecord) && <Text accessibilityRole="alert" style={styles.subtitle}>{RECORDING_ASR_BLOCKED}</Text>}
          {selectedRecord.errorDetails?.status === 404 && selectedRecord.errorDetails.code === 'transcription_job_not_found' && <PrimaryButton secondary title="重新提交这份录音" disabled={notesReading || !notesReady || !!working || !!activeProgress || importing} onPress={() => {
            const record = selectedRecord
            Alert.alert('重新提交录音？', '会先再次检查原任务；若服务仍找不到，将保留原记录并新建转写任务。若原任务稍后出现，可能产生两次处理。', [
              { text: '取消', style: 'cancel' },
              { text: '重新提交', onPress: () => {
                if (!uiCurrent() || locked.current || activeProgress || importing || notesReading || !notesReady) return
                setSelected(null)
                void action(record, async () => {
                  await Sound.stopPlayer()
                  if (uiCurrent()) setPlaying(null)
                  const next = await restartMissingMeetingJob(record.id)
                  await generateRecording(next, text => { if (uiCurrent()) setPhase(text) }, true)
                }, 'generation')
              } },
            ])
          }} />}
          {(selectedRecord.meetingFilePrepared?.checkpoint.result || selectedRecord.transcriptionCheckpoint && selectedRecord.speakerCheckpoint) && <PrimaryButton secondary title="仅生成纪要" disabled={recordingASRBlocked(selectedRecord) || notesReading || !notesReady || !!working || !!activeProgress || importing} onPress={() => setSummaryOnly(true)} />}
          {selectedRecord.generation ? <Text style={styles.subtitle}>{selectedRecord.errorDetails?.status === 404 && selectedRecord.errorDetails.code === 'transcription_job_not_found' ? '重新提交时沿用上次选择的模型。' : '继续使用上次选择的模型与已保存进度。'}</Text> : <CloudModelPicker disabled={!!working || importing} onReady={setModelsReady} />}
          {!selectedRecord.generation?.summaryOnly && !(selectedRecord.errorDetails?.status === 404 && selectedRecord.errorDetails.code === 'transcription_job_not_found') && <PrimaryButton title={selectedRecord.generation ? `${selectedRecord.generation.status === 'paused' ? '重试生成' : '继续生成'}版本 ${selectedRecord.generation.version || 1}` : `生成版本 ${Math.max(selectedRecord.lastNoteVersion || 0, ...notes.filter(note => note.task_id === selectedRecord.id).map(note => note.version || 1)) + 1}`} disabled={recordingASRBlocked(selectedRecord) || notesReading || !notesReady || !!working || !!activeProgress || importing || (!selectedRecord.generation && !modelsReady)} onPress={() => {
            if (recordingASRBlocked(selectedRecord) || !uiCurrent() || locked.current || activeProgress || importing || notesReading || !notesReady || (!selectedRecord.generation && !modelsReady)) return
            const record = selectedRecord
            const epoch = identityEpoch()
            setSelected(null)
            void action(record, async () => {
              const owner = await readAccountId()
              if (!owner || identityEpoch() !== epoch) throw new SessionScopeChangedError()
              await Sound.stopPlayer()
              if (uiCurrent()) setPlaying(null)
              if (identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new SessionScopeChangedError()
              // Navigation suppresses view updates, never the worker's owner/save guards.
              await generateRecording(record, text => { if (uiCurrent()) setPhase(text) }, !!record.generation)
            }, 'generation')
          }} />}
          <PrimaryButton secondary title="暂不生成" disabled={!!working || importing} onPress={() => setSelected(null)} />
          </>}
        </>}
      </BottomActionSheet>
      {renaming && (
        <RenameDialog
          title={recordingDisplayName(renaming)}
          label="录音名称"
          onClose={() => setRenaming(null)}
          onSave={async title => {
            await renameRecording(renaming, title)
            await load()
          }}
        />
      )}
    </View>
  )
}
