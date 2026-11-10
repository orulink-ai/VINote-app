import { sourceRecoveryCopy } from '../lib/sourceRecoveryCopy'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Pressable, ScrollView, View } from 'react-native'
import FS from 'react-native-fs'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { AsyncState } from '../components/AsyncState'
import { RecordingProcessingStatus } from '../components/RecordingProcessingStatus'
import { ClientNoteHistorySection } from '../components/ClientNoteHistorySection'
import { Text } from '../components/AppText'
import { colors, styles } from '../design-system/theme'
import { meetingDisplayName } from '../features/recording/recordingTitle'
import { subscribeWorkspace } from '../lib/workspace'
import { readAccountId, sessionRevision } from '../lib/storage'
import type { WorkspaceState } from '../lib/workspaceStorage'
import { listRecordings, type LocalRecording } from '../features/recording/recordingLibrary'
import { useRecordingProgress } from '../features/recording/useRecordingProgress'
import { mcpApi, runLabels, type MCPRun } from '../lib/mcp'
import { flushAutomaticDeliveries } from '../lib/feishu'
import { readCurrentIntakeHistory, sameIntakeHistoryTarget, type IntakeHistoryRecord, type IntakeHistoryTarget } from '../lib/intakeHistory'
import { listClientNoteHistory, savedNoteForClientTask, type ClientNoteHistoryItem } from '../lib/clientNoteHistoryList'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'

type Job = { id: string; note_key: string; status: string; error: string; model: string; updated_at: string }
// Warm contextual returns only. This is not business data or a cross-login cache.
const pageViews = new Map<string, { category: string; y: number }>()
export function TasksScreen({ onBack, onOpen, onRecording, onMcp, onIntake, dataOnly = false, showBack = dataOnly, backLabel = '返回我的' }: { onBack?: () => void; backLabel?: string; onOpen: (id: string) => void; onRecording: (id: string) => void; onMcp: () => void; onIntake?: (target: IntakeHistoryTarget) => void; dataOnly?: boolean; showBack?: boolean }) {
  const [state, setState] = useState<WorkspaceState>({ cache: {}, mappings: {} }), [records, setRecords] = useState<LocalRecording[]>([])
  const [jobs, setJobs] = useState<Job[]>([]), [runs, setRuns] = useState<MCPRun[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [storage, setStorage] = useState(''), [category, setCategory] = useState(dataOnly ? '存储' : '生成')
  const [recordsReady, setRecordsReady] = useState(false)
  const [intake, setIntake] = useState<IntakeHistoryRecord | null>(null), [intakeError, setIntakeError] = useState(''), [intakeDetails, setIntakeDetails] = useState(false)
  const [history, setHistory] = useState<ClientNoteHistoryItem[]>([]), [historyNotes, setHistoryNotes] = useState<Note[]>([]), [historyError, setHistoryError] = useState('')
  const historyScope = useRef<{ owner: string; session: number } | null>(null)
  const progress = useRecordingProgress(), lock = useRef(false), mounted = useRef(true), readSequence = useRef(0)
  const pageIdentity = useRef(''), scroll = useRef<React.ElementRef<typeof ScrollView>>(null), restoredScroll = useRef(false)
  const local = async () => {
    const sequence = ++readSequence.current, session = sessionRevision(), owner = await readAccountId()
    if (!owner) throw new Error('请登录后读取处理记录')
    const recordings = await listRecordings()
    let source: IntakeHistoryRecord | null = null, sourceError = ''
    let historyItems: ClientNoteHistoryItem[] = [], notes: Note[] = [], nextHistoryError = ''
    if (!dataOnly && category === '生成') {
      try { source = await readCurrentIntakeHistory(owner) } catch (cause) { sourceError = cause instanceof Error ? cause.message : '来源任务读取失败，请重新读取' }
      try {
        const guard = async () => { if (await readAccountId() !== owner || sessionRevision() !== session) throw new Error('账号已切换，请重新读取任务') }
        historyItems = await listClientNoteHistory(owner, guard)
        notes = await listNotes(owner)
        await guard()
      } catch (cause) { nextHistoryError = cause instanceof Error ? cause.message : '笔记任务读取失败，请重试' }
    }
    if (mounted.current && sequence === readSequence.current && await readAccountId() === owner && sessionRevision() === session) {
      if (!pageIdentity.current) {
        pageIdentity.current = `${owner}:${sessionRevision()}:${dataOnly ? 'data' : 'tasks'}`
        const prior = pageViews.get(pageIdentity.current)
        if (prior && (dataOnly ? ['存储'] : ['生成', '飞书']).includes(prior.category)) setCategory(prior.category)
      }
      setRecords(recordings); setRecordsReady(true)
      if (!dataOnly && category === '生成') { setIntake(source); setIntakeError(sourceError); setHistory(historyItems); setHistoryNotes(notes); setHistoryError(nextHistoryError); historyScope.current = { owner, session } }
    }
  }
  const openSavedHistory = async (item: ClientNoteHistoryItem, noteId: string) => {
    const scope = historyScope.current
    if (!scope || lock.current) return
    lock.current = true; setBusy(true); setHistoryError('')
    try {
      const guard = async () => { if (await readAccountId() !== scope.owner || sessionRevision() !== scope.session) throw new Error('账号已切换，请重新读取任务') }
      await guard()
      const latest = (await listClientNoteHistory(scope.owner, guard)).find(row => row.operationId === item.operationId)
      const notes = await listNotes(scope.owner); await guard()
      if (!latest || savedNoteForClientTask(latest, notes) !== noteId) throw new Error('笔记或任务已变化，请刷新后重试')
      if (mounted.current) onOpen(noteId)
    } catch (cause) { if (mounted.current) setHistoryError(cause instanceof Error ? cause.message : '无法打开笔记，请重试') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const openIntake = async () => {
    if (!onIntake || !intake?.target || lock.current) return
    const expected = intake.target
    lock.current = true; setBusy(true); setIntakeError('')
    try {
      const latest = await readCurrentIntakeHistory(expected.owner)
      if (!mounted.current) return
      if (!sameIntakeHistoryTarget(expected, latest?.target)) {
        setIntake(null); setIntakeDetails(false)
        setIntakeError('当前来源任务已变化，请重新读取并核对；不会覆盖另一份来源或打开旧任务')
        return
      }
      onIntake(expected)
    } catch (cause) {
      if (mounted.current) { setIntake(null); setIntakeError(cause instanceof Error ? cause.message : '来源任务无法核验，请重新读取') }
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const action = async (fn: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await fn(); await local() } catch (cause) { setError((cause as Error).message) } finally { lock.current = false; setBusy(false) } }
  useEffect(() => {
    mounted.current = true
    let active = true
    const update = () => { if (active) void local().catch(cause => { if (active) setError(cause.message) }) }
    update(); const unsubscribe = subscribeWorkspace(update)
    return () => { active = false; mounted.current = false; readSequence.current++; unsubscribe() }
  }, [])
  const refresh = async () => {
    await local()
    if (category === 'MCP') setRuns((await mcpApi<{ runs: MCPRun[] }>('/runs?limit=50&offset=0')).runs)
    if (category === '存储') {
      const files = await listRecordings(); let bytes = 0, count = 0
      for (const record of files) { const path = record.uri.replace('file://', ''); if (await FS.exists(path)) { bytes += Number((await FS.stat(path)).size); count++ } }
      const space = await FS.getFSInfo()
      setStorage(`本机原音 ${count} 个，约 ${(bytes / 1048576).toFixed(1)} MB；设备可用 ${(space.freeSpace / 1073741824).toFixed(1)} GB。`)
    }
  }
  useEffect(() => {
    if (pageIdentity.current) pageViews.set(pageIdentity.current, { category, y: pageViews.get(pageIdentity.current)?.y || 0 })
    void action(refresh)
  }, [category])
  useEffect(() => {
    if (dataOnly || category !== '生成') return
    // Poll only local task state. Reading it never submits or retries a model request.
    const timer = setInterval(() => { if (AppState.currentState === 'active') void local().catch(() => {}) }, 3000)
    return () => clearInterval(timer)
  }, [category, dataOnly])
  const meetingTasks = records.filter(record => record.generation || record.error || progress?.recordId === record.id || historyNotes.some(note => !note.deleted && note.id === record.noteId && note.task_id === record.id))
  return <View style={styles.screen}><ScreenHeader title={dataOnly ? '存储' : '任务'} onBack={showBack ? onBack : undefined} backLabel={backLabel} />
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
      onScroll={event => { if (pageIdentity.current) pageViews.set(pageIdentity.current, { category, y: event.nativeEvent.contentOffset.y }) }}
      onContentSizeChange={() => { if (!restoredScroll.current && pageIdentity.current) { const previous = pageViews.get(pageIdentity.current); if (previous) scroll.current?.scrollTo({ y: previous.y, animated: false }); restoredScroll.current = true } }}>
      {!dataOnly && <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.primarySoft }}>
        {[{ value: '生成', label: '内容处理' }, { value: '飞书', label: '发布与通知' }].map(({ value, label }) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: category === value, disabled: busy }} disabled={busy} onPress={() => setCategory(value)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: category === value ? colors.card : 'transparent' }}><Text style={[styles.noteTitle, { color: category === value ? colors.ink : colors.muted }]}>{label}</Text></Pressable>)}
      </View>}
      {busy && <Text testID="tasks-read-status" accessibilityLiveRegion="polite" style={styles.subtitle}>{recordsReady ? '正在更新状态' : '正在读取状态'}</Text>}
      {category === '生成' && <>
        {(intake || intakeError) && <Text style={styles.sectionTitle}>笔记来源任务</Text>}
        <AsyncState error={sourceRecoveryCopy(intakeError)} onRetry={() => void action(local)} retryLabel="重新读取来源任务" />
        {intake ? <View style={[styles.card, { gap: 8 }]}>
          <Text style={styles.noteTitle}>{intake.title}</Text><Text accessibilityLiveRegion="polite" style={styles.subtitle}>{intake.status}</Text>
          <Text style={styles.subtitle}>{sourceRecoveryCopy(intake.help)}</Text>
          {intake.target && onIntake ? <PrimaryButton secondary title={intake.action} disabled={busy} onPress={() => void openIntake()} /> : intake.target && <Text style={styles.subtitle}>请从笔记的链接或文件整理入口返回原来源页核验。</Text>}
          {__DEV__ && <PrimaryButton tertiary title={intakeDetails ? '收起开发诊断' : '开发诊断'} accessibilityHint="查看内部诊断信息" onPress={() => setIntakeDetails(value => !value)} />}
          {__DEV__ && intakeDetails && <View style={{ gap: 4 }}>{intake.operationId && <Text selectable style={styles.subtitle}>提交编号：{intake.operationId}</Text>}{intake.taskId && <Text selectable style={styles.subtitle}>任务编号：{intake.taskId}</Text>}</View>}
        </View> : null}
        <AsyncState error={historyError} onRetry={() => void action(local)} retryLabel="重新读取笔记任务" />
        {history.some(item => item.operationId !== intake?.operationId) && <ClientNoteHistorySection items={history.filter(item => item.operationId !== intake?.operationId)} notes={historyNotes} onOpen={(item, noteId) => void openSavedHistory(item, noteId)} />}
        {meetingTasks.length > 0 && <Text style={[styles.subtitle, { fontWeight: '500', paddingTop: 8 }]}>会议任务</Text>}
        {meetingTasks.map(record => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`${meetingDisplayName(record, historyNotes.find(note => !note.deleted && note.id === record.noteId)?.title)}，${record.error ? '查看原因' : '查看详情'}`} onPress={() => onRecording(record.id)} style={({ pressed }) => [styles.listRow, { borderWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0, paddingHorizontal: 0, paddingVertical: 10, backgroundColor: pressed ? colors.primarySoft : 'transparent', flexDirection: 'row', alignItems: 'center' }]}>
          <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={2} style={styles.noteTitle}>{meetingDisplayName(record, historyNotes.find(note => !note.deleted && note.id === record.noteId)?.title)}</Text>
          <RecordingProcessingStatus compact record={record} progress={progress?.recordId === record.id ? progress : null} working={progress?.recordId === record.id} phase="" noteSaved={historyNotes.some(note => !note.deleted && note.id === record.noteId && note.task_id === record.id)} notesReading={false} /></View>
          <Text style={styles.subtitle}>›</Text>
        </Pressable>)}
        {!busy && recordsReady && !intake && !intakeError && !historyError && history.length === 0 && meetingTasks.length === 0 && <Text style={styles.subtitle}>暂无任务。生成会议纪要或笔记后，可在这里查看进度。</Text>}
      </>}
      {category === '飞书' && <><Text style={styles.noteTitle}>查看发布状态</Text><Text style={styles.subtitle}>打开会议纪要或笔记，选择“发布到飞书”，可查看文档和通知状态。当前需手动发布，旧的自动发布记录可核对，但不会自动重发。</Text><PrimaryButton secondary title="核对旧发布记录" disabled={busy} onPress={() => void action(async () => { await flushAutomaticDeliveries(); Alert.alert('没有待核对的旧发布记录') })} /></>}
      {category === 'MCP' && <><PrimaryButton title="管理工具与调用" onPress={onMcp} />{runs.map(run => <View key={run.id} style={styles.listRow}><Text style={styles.noteTitle}>{run.toolName} · {runLabels[run.status]}</Text><Text style={styles.subtitle}>{run.error?.message}</Text></View>)}</>}
      {category === '存储' && <><Text style={styles.noteBody}>{storage || '点刷新读取本机占用。'}</Text><Text style={styles.subtitle}>正文与版本保留在资料库；原文件在文件库独立管理。</Text>{records.map(record => <PrimaryButton key={record.id} tertiary title={`${record.title} · 查看原文件`} onPress={() => onRecording(record.id)} />)}</>}
      <AsyncState error={error} retryLabel="重新读取状态" onRetry={() => void action(refresh)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        <Text style={styles.subtitle}>{category === '生成' && !dataOnly ? '任务状态会自动更新' : '查看最新状态'}</Text>
        <PrimaryButton tertiary title="刷新当前状态" disabled={busy} onPress={() => void action(refresh)} />
      </View>
    </ScrollView>
  </View>
}
