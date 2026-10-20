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
import { RecordingSummaryRecovery } from '../components/RecordingSummaryRecovery'
import { readAccountId } from '../lib/storage'
import { identityEpoch, SessionScopeChangedError } from '../lib/sessionIdentity'
import { useRecordingProgress } from '../features/recording/useRecordingProgress'
export function RecordingsScreen({
  onBack,
  backLabel = '返回工作台',
  onOpenNote,
  initialGenerateId,
  initialImport = false,
  initialFocusId,
}: {
  onBack: () => void
  backLabel?: string
  onOpenNote: (id: string) => void
  initialGenerateId?: string | null
  initialImport?: boolean
  initialFocusId?: string | null
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
  const [playing, setPlaying] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
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
  const play = async (record: LocalRecording) => {
    await Sound.stopPlayer()
    Sound.removePlayBackListener()
    Sound.removePlaybackEndListener()
    if (playing === record.id) {
      setPlaying(null)
      return
    }
    setPlaying(null)
    setPosition(0)
    if (isRecordingActive()) throw new Error('请先结束当前录音，再播放原声')
    await Sound.startPlayer(record.uri)
    setPlaying(record.id)
    Sound.addPlayBackListener(event =>
      setPosition(Math.floor(event.currentPosition / 1000)),
    )
    Sound.addPlaybackEndListener(() => {
      setPlaying(null)
      void Sound.stopPlayer().catch(() => {})
    })
  }
  const selectedRecord = items.find(item => item.id === selected)
  return (
    <View style={[styles.screen, { backgroundColor: colors.card }]}>
      <ScreenHeader title={focusedId ? '原录音' : '录音库'} onBack={goBack} backLabel={focusedId && !initialFocusId ? '返回录音库' : backLabel} disabled={importing || (!!working && workingKind !== 'generation' && (!focusedId || !!initialFocusId))} />
      <View style={[styles.content, { paddingBottom: 12 }]}>
        <View style={{ gap: 7, paddingTop: 10 }}>
          <Text style={styles.subtitle}>{focusedId ? '管理这份原录音，会议纪要与版本独立保留。' : '录音与纪要分别管理。'}</Text>
        </View>
        {!focusedId && <PrimaryButton
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
        data={focusedId ? items.filter(item => item.id === focusedId) : items}
        refreshing={loading}
        onRefresh={load}
        keyExtractor={item => item.id}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingBottom: 28,
          gap: 0,
        }}
        ListEmptyComponent={!error ?
          <View style={[styles.emptyState]}>
            <Text style={styles.noteTitle}>
              {loading ? '正在读取录音…' : focusedId ? '该原录音已不可用' : '还没有录音'}
            </Text>
            <Text style={styles.subtitle}>{loading ? '正在读取此设备保存的原录音。' : focusedId ? '可能已在此设备删除。已保存的纪要和版本保留，可通过顶部入口返回。' : '录制或导入的音频会显示在这里。'}</Text>
          </View> : undefined
        }
        renderItem={({ item }) => !focusedId ? (
          <View style={styles.listRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`打开原录音${item.title}`} disabled={importing} onPress={() => setFocusedId(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 34, height: 34, borderRadius: 7, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><WorkspaceIcon name="record" muted /></View>
              <View style={{ flex: 1, gap: 5 }}><Text style={styles.noteTitle}>{item.title}</Text><Text style={styles.subtitle}>{new Date(item.createdAt).toLocaleDateString('zh-CN')} · {Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, '0')} · {item.error ? '需处理' : item.generation ? '处理中' : notesReading ? '正在核对纪要' : !notesReady ? '纪要状态待核对' : notes.some(note => note.task_id === item.id) ? '纪要已完成' : '未生成'}</Text></View><Text style={styles.subtitle}>›</Text>
            </Pressable>
            {item.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{sourceRecoveryCopy(item.error)}</Text>}
            {activeProgress?.recordId === item.id && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>正在处理，打开录音查看两项进度</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><PrimaryButton tertiary title={notesReading ? '正在核对纪要…' : !notesReady ? '纪要状态待核对' : working === item.id || activeProgress?.recordId === item.id ? '正在处理…' : item.generation?.status === 'pending' ? '继续处理' : item.generation?.status === 'paused' ? '重试生成纪要' : notes.some(note => note.task_id === item.id) ? '再生成一版' : '生成会议纪要'} disabled={notesReading || !notesReady || !!working || !!activeProgress || importing} onPress={() => { setModelsReady(false); setSelected(item.id) }} /></View>
          </View>
        ) : (
          <View style={styles.listRow}>
            <Text style={styles.noteTitle}>{item.title}</Text>
            <RecordingProcessingStatus key={item.id} record={item} progress={activeProgress?.recordId === item.id ? activeProgress : null}
              working={working === item.id} phase={working === item.id ? phase : ''} noteSaved={notesReady && notes.some(note => note.task_id === item.id)} notesReading={notesReading} notesReady={notesReady}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {notes
              .filter(note => note.task_id === item.id)
              .sort((a, b) => (a.version || 1) - (b.version || 1))
              .map(note => (
                <PrimaryButton
                  key={note.id}
                  secondary
                  title={`版本 ${note.version || 1}`}
                  accessibilityLabel={`查看版本 ${note.version || 1}`}
                  style={{ minHeight: 44, paddingVertical: 8, paddingHorizontal: 16 }}
                  disabled={!!working || importing}
                  onPress={() => onOpenNote(note.id)}
                />
              ))}
            </View>
            <PrimaryButton
              title={notesReading ? '正在核对纪要…' : !notesReady ? '纪要状态待核对' : working === item.id ? '正在处理…' : item.generation?.status === 'pending' ? '继续处理' : item.generation?.status === 'paused' ? '重试生成纪要' : notes.some(note => note.task_id === item.id) ? '再生成一版' : '生成会议纪要'}
              disabled={notesReading || !notesReady || !!working || !!activeProgress || importing}
              onPress={() => { setModelsReady(false); setSelected(item.id) }}
            />
            </RecordingProcessingStatus>
            <DetailDisclosure key={`source-${item.id}`} title="来源与录音操作">
              <Text style={styles.subtitle}>{item.source === 'import' ? '导入音频' : '会议录音'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
              <Text style={styles.subtitle}>{item.duration ? `${Math.floor(item.duration / 60)}分${Math.floor(item.duration % 60)}秒` : '时长待播放确认'} · 原音频保留在文件库</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PrimaryButton
                secondary
                style={{ flex: 1 }}
                title={
                  playing === item.id ? '停止 · ' + position + 's' : '播放原声'
                }
                disabled={!!working || importing}
                onPress={() => {
                  setPhase('正在打开音频…')
                  void action(item, () => play(item))
                }}
              />
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
                onPress={() => setRenaming(item)}
              >
                <Text style={styles.link}>修改名称</Text>
              </Pressable>
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
                    '删除录音？',
                    '原音频删除后无法恢复，已经保存的会议纪要不受影响。',
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
                          })
                        },
                      },
                    ],
                  )
                }
              >
                <Text style={[styles.link, { color: colors.danger }]}>
                  删除录音
                </Text>
              </Pressable>
            </View>
            </DetailDisclosure>
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
          <DetailDisclosure key={selected} title="处理说明"><Text style={styles.subtitle}>录音和已有纪要继续保留。转写与说话人分析分别保存进度；未确认的转写不能重新发送。</Text></DetailDisclosure>
          {notesReading && <Text style={styles.subtitle}>正在核对已有纪要与版本…</Text>}
          {!notesReading && !notesReady && <><Text accessibilityRole="alert" style={styles.subtitle}>纪要状态暂未读取，先重新核对再生成；原录音保留。</Text><PrimaryButton secondary title="重新核对纪要" onPress={() => { void load() }} /></>}
          {recordingASRBlocked(selectedRecord) && <Text accessibilityRole="alert" style={styles.subtitle}>{RECORDING_ASR_BLOCKED}</Text>}
          {selectedRecord.transcriptionCheckpoint && selectedRecord.speakerCheckpoint && <PrimaryButton secondary title="仅生成纪要" disabled={recordingASRBlocked(selectedRecord) || notesReading || !notesReady || !!working || !!activeProgress || importing} onPress={() => setSummaryOnly(true)} />}
          {selectedRecord.generation ? <Text style={styles.subtitle}>继续使用上次选择的模型与已保存进度。</Text> : <CloudModelPicker disabled={!!working || importing} onReady={setModelsReady} />}
          {!selectedRecord.generation?.summaryOnly && <PrimaryButton title={selectedRecord.generation ? `${selectedRecord.generation.status === 'paused' ? '重试生成' : '继续生成'}版本 ${selectedRecord.generation.version || 1}` : `生成版本 ${Math.max(selectedRecord.lastNoteVersion || 0, ...notes.filter(note => note.task_id === selectedRecord.id).map(note => note.version || 1)) + 1}`} disabled={recordingASRBlocked(selectedRecord) || notesReading || !notesReady || !!working || !!activeProgress || importing || (!selectedRecord.generation && !modelsReady)} onPress={() => {
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
          title={renaming.title}
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
