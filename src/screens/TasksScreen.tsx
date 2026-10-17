import { sourceRecoveryCopy } from '../lib/sourceRecoveryCopy'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import FS from 'react-native-fs'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { AsyncState } from '../components/AsyncState'
import { RecordingProcessingStatus } from '../components/RecordingProcessingStatus'
import { Text } from '../components/AppText'
import { styles } from '../design-system/theme'
import { subscribeWorkspace } from '../lib/workspace'
import { readAccountId, sessionRevision } from '../lib/storage'
import type { WorkspaceState } from '../lib/workspaceStorage'
import { listRecordings, type LocalRecording } from '../features/recording/recordingLibrary'
import { useRecordingProgress } from '../features/recording/useRecordingProgress'
import { mcpApi, runLabels, type MCPRun } from '../lib/mcp'
import { flushAutomaticDeliveries } from '../lib/feishu'
import { readCurrentIntakeHistory, sameIntakeHistoryTarget, type IntakeHistoryRecord, type IntakeHistoryTarget } from '../lib/intakeHistory'

type Job = { id: string; note_key: string; status: string; error: string; model: string; updated_at: string }
// Warm contextual returns only. This is not business data or a cross-login cache.
const pageViews = new Map<string, { category: string; y: number }>()
export function TasksScreen({ onBack, onOpen, onRecording, onMcp, onIntake, dataOnly = false, backLabel = '返回我的' }: { onBack?: () => void; backLabel?: string; onOpen: (id: string) => void; onRecording: (id: string) => void; onMcp: () => void; onIntake?: (target: IntakeHistoryTarget) => void; dataOnly?: boolean }) {
  const [state, setState] = useState<WorkspaceState>({ cache: {}, mappings: {} }), [records, setRecords] = useState<LocalRecording[]>([])
  const [jobs, setJobs] = useState<Job[]>([]), [runs, setRuns] = useState<MCPRun[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [storage, setStorage] = useState(''), [category, setCategory] = useState(dataOnly ? '存储' : '生成')
  const [recordsReady, setRecordsReady] = useState(false)
  const [intake, setIntake] = useState<IntakeHistoryRecord | null>(null), [intakeError, setIntakeError] = useState(''), [intakeDetails, setIntakeDetails] = useState(false)
  const progress = useRecordingProgress(), lock = useRef(false), mounted = useRef(true), readSequence = useRef(0)
  const pageIdentity = useRef(''), scroll = useRef<React.ElementRef<typeof ScrollView>>(null), restoredScroll = useRef(false)
  const local = async () => {
    const sequence = ++readSequence.current, session = sessionRevision(), owner = await readAccountId()
    if (!owner) throw new Error('请登录后读取处理记录')
    const recordings = await listRecordings()
    let source: IntakeHistoryRecord | null = null, sourceError = ''
    if (!dataOnly && category === '生成') {
      try { source = await readCurrentIntakeHistory(owner) } catch (cause) { sourceError = cause instanceof Error ? cause.message : '来源任务读取失败，请重新读取' }
    }
    if (mounted.current && sequence === readSequence.current && await readAccountId() === owner && sessionRevision() === session) {
      if (!pageIdentity.current) {
        pageIdentity.current = `${owner}:${sessionRevision()}:${dataOnly ? 'data' : 'tasks'}`
        const prior = pageViews.get(pageIdentity.current)
        if (prior && (dataOnly ? ['存储'] : ['生成', '飞书', 'MCP']).includes(prior.category)) setCategory(prior.category)
      }
      setRecords(recordings); setRecordsReady(true)
      if (!dataOnly && category === '生成') { setIntake(source); setIntakeError(sourceError); setIntakeDetails(false) }
    }
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
  return <View style={styles.screen}><ScreenHeader title={dataOnly ? '存储' : '任务与恢复'} onBack={onBack} backLabel={backLabel} />
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
      onScroll={event => { if (pageIdentity.current) pageViews.set(pageIdentity.current, { category, y: event.nativeEvent.contentOffset.y }) }}
      onContentSizeChange={() => { if (!restoredScroll.current && pageIdentity.current) { const previous = pageViews.get(pageIdentity.current); if (previous) scroll.current?.scrollTo({ y: previous.y, animated: false }); restoredScroll.current = true } }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{(dataOnly ? ['存储'] : ['生成', '飞书', 'MCP']).map(label => <PrimaryButton key={label} tertiary={category !== label} secondary={category === label} title={label} disabled={busy} onPress={() => setCategory(label)} />)}</View>
      <View testID="tasks-read-status" style={{ minHeight: 24, justifyContent: 'center' }}>
        <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{busy ? recordsReady ? '正在更新状态' : '正在读取状态' : ' '}</Text>
      </View>
      {category === '生成' && <>
        <Text style={styles.sectionTitle}>当前来源任务</Text>
        <AsyncState error={sourceRecoveryCopy(intakeError)} onRetry={() => void action(local)} retryLabel="重新读取来源任务" />
        {intake ? <View style={[styles.card, { gap: 8 }]}>
          <Text style={styles.noteTitle}>{intake.title}</Text><Text accessibilityLiveRegion="polite" style={styles.subtitle}>{intake.status}</Text>
          <Text style={styles.subtitle}>{sourceRecoveryCopy(intake.help)}</Text>
          {intake.target && onIntake ? <PrimaryButton secondary title={intake.action} disabled={busy} onPress={() => void openIntake()} /> : intake.target && <Text style={styles.subtitle}>请从笔记的链接或文件整理入口返回原来源页核验。</Text>}
          {__DEV__ && <PrimaryButton tertiary title={intakeDetails ? '收起开发诊断' : '开发诊断'} accessibilityHint="查看内部诊断信息" onPress={() => setIntakeDetails(value => !value)} />}
          {__DEV__ && intakeDetails && <View style={{ gap: 4 }}>{intake.operationId && <Text selectable style={styles.subtitle}>提交编号：{intake.operationId}</Text>}{intake.taskId && <Text selectable style={styles.subtitle}>任务编号：{intake.taskId}</Text>}</View>}
        </View> : !busy && !intakeError && <Text style={styles.subtitle}>当前没有可核验的来源任务记录</Text>}
        <Text style={styles.sectionTitle}>录音任务</Text>
        {records.filter(record => record.generation || record.error || progress?.recordId === record.id).map(record => <View key={record.id} style={styles.listRow}>
          <Text style={styles.noteTitle}>{record.title}</Text>
          <RecordingProcessingStatus record={record} progress={progress?.recordId === record.id ? progress : null} working={progress?.recordId === record.id} phase="" noteSaved={false} notesReading={false}>
            <PrimaryButton secondary title="查看录音与恢复入口" onPress={() => onRecording(record.id)} />
          </RecordingProcessingStatus>
        </View>)}
      </>}
      {category === '飞书' && <><Text style={styles.subtitle}>文档、权限和每个接收人的状态在内容详情的“导出与发布”中查询。恢复队列只补交付，不重新生成纪要。</Text><PrimaryButton secondary title="恢复已授权的自动交付队列" disabled={busy} onPress={() => Alert.alert('恢复自动交付？', '仅处理此前启用自动交付的已保存内容，可能继续创建文档或通知。', [{ text: '取消' }, { text: '恢复', onPress: () => void action(flushAutomaticDeliveries) }])} /></>}
      {category === 'MCP' && <><PrimaryButton title="管理工具与调用" onPress={onMcp} />{runs.map(run => <View key={run.id} style={styles.listRow}><Text style={styles.noteTitle}>{run.toolName} · {runLabels[run.status]}</Text><Text style={styles.subtitle}>{run.error?.message}</Text></View>)}</>}
      {category === '存储' && <><Text style={styles.noteBody}>{storage || '点刷新读取本机占用。'}</Text><Text style={styles.subtitle}>正文与版本保留在资料库；原文件在文件库独立管理。</Text>{records.map(record => <PrimaryButton key={record.id} tertiary title={`${record.title} · 查看原文件`} onPress={() => onRecording(record.id)} />)}</>}
      <AsyncState error={error} retryLabel="重新读取状态" onRetry={() => void action(refresh)} />
      <PrimaryButton secondary title="刷新当前状态" disabled={busy} onPress={() => void action(refresh)} />
    </ScrollView>
  </View>
}
