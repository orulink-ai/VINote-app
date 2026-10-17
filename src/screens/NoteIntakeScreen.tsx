import { DetailDisclosure } from '../components/DetailDisclosure'
import { BottomActionSheet } from '../components/BottomActionSheet'
import { ApiError } from '../lib/errors'
import { bindIntakeModel, guardIntakeModel, readIntakeModelContext, sameIntakeModelContext, verifyIntakeModel, type IntakeModelBinding, type IntakeModelContext } from '../lib/intakeModelConfirmation'
import { sourceRecoveryCopy } from '../lib/sourceRecoveryCopy'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, AppState, BackHandler, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../components/AppText'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { Field } from '../components/Field'
import { AsyncState } from '../components/AsyncState'
import { ProcessingProgress } from '../components/ProcessingProgress'
import { colors, styles } from '../design-system/theme'
import { readAccountId } from '../lib/storage'
import { importLocalFile, verifyLocalFile, type LocalFile } from '../lib/localFiles'
import { generationBaseUrl, integrationJson, verifyContentService } from '../lib/integration'
import { isExplicitVideoUrl } from '../lib/intakeCapabilities'
import { intakeHistoryRecord, sameIntakeHistoryTarget, type IntakeHistoryTarget } from '../lib/intakeHistory'
import { assertIntakeOrigin, inspectIntake, intakeFileName, intakeSourceType, readIntake, recoverIntake, submitIntake, writeIntake, type IntakeDraft } from '../lib/noteIntake'

const empty: IntakeDraft = { mode: 'url', url: '' }
export function NoteIntakeScreen({ onBack, onSaved, initialMode = 'url', initialFile, backLabel = '返回笔记', recoveryTarget }: { onBack: () => void; onSaved: (id: string) => void; initialMode?: 'url' | 'file'; initialFile?: LocalFile; backLabel?: string; recoveryTarget?: IntakeHistoryTarget }) {
  const [draft, setDraft] = useState<IntakeDraft>(empty), [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [terminal, setTerminal] = useState(false), [retryable, setRetryable] = useState(false)
  const [taskProgress, setTaskProgress] = useState<number | null>(null)
  const [recoveredNoteId, setRecoveredNoteId] = useState('')
  const [continueExisting, setContinueExisting] = useState(false)
  const [prepareAttempt, setPrepareAttempt] = useState(0)
  const [serviceAttempt, setServiceAttempt] = useState(0)
  const [serviceState, setServiceState] = useState<'checking' | 'ready' | 'failed'>('checking')
  const [serviceError, setServiceError] = useState('')
  const [uploadLimit, setUploadLimit] = useState<number | null>(null)
  const [videoLinksAvailable, setVideoLinksAvailable] = useState<boolean | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [modelSheet, setModelSheet] = useState(false), [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState(''), [modelContext, setModelContext] = useState<IntakeModelContext | null>(null)
  const modelBinding = useRef<IntakeModelBinding | null>(null), modelSequence = useRef(0), modelSheetOpen = useRef(false)
  const modelPosting = useRef(false), [modelSending, setModelSending] = useState(false)
  const closeModels = () => {
    if (modelPosting.current) return
    modelSequence.current++; modelSheetOpen.current = false; modelBinding.current = null
    setModelSheet(false); setModelLoading(false); setModelContext(null); setModelError('')
  }
  const owner = useRef(''), current = useRef(draft), mounted = useRef(true), locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saved = useRef(false), query = useRef<() => Promise<void>>(async () => {})
  current.current = draft
  const accept = (value: IntakeDraft) => {
    if (current.current.taskId !== value.taskId || current.current.operationId !== value.operationId || current.current.generationOrigin !== value.generationOrigin) closeModels()
    current.current = value; setDraft(value)
  }
  const persist = async () => writeIntake(owner.current, current.current)
  const schedule = () => { if (timer.current) clearTimeout(timer.current); if (mounted.current && AppState.currentState === 'active') timer.current = setTimeout(() => void query.current(), 3000) }
  query.current = async () => {
    if (!mounted.current || locked.current || (!current.current.taskId && !current.current.operationId && !current.current.uncertain) || saved.current || modelSheetOpen.current) return
    locked.current = true; setBusy(true); setError('')
    try {
      if (current.current.operationId && (!current.current.taskId || current.current.uncertain || current.current.receiptState === 'reserved')) {
        const receipt = await recoverIntake(owner.current, current.current)
        if (!mounted.current) return
        accept(receipt)
        if (receipt.receiptState === 'reserved') { setMessage('提交已登记，但尚未确认排队。请继续核验原提交，不会自动重新派发。'); return }
      }
      const result = await inspectIntake(owner.current, current.current)
      if (!mounted.current) return
      if (result.note) {
        saved.current = true
        if (initialFile && current.current.file?.id !== initialFile.id) { setRecoveredNoteId(result.note.id); setMessage('原任务的笔记已保存。你可以查看原结果，或明确切换到文件库所选文件。') }
        else onSaved(result.note.id)
        return
      }
      const failed = ['failed', 'error', 'not_found'].includes(result.status.status)
      setTerminal(failed); setRetryable(!current.current.retryUncertain && !!result.status.retryable && ['failed', 'error'].includes(result.status.status))
      const measured = result.status.progress
      setTaskProgress(typeof measured === 'number' && Number.isFinite(measured) && measured >= 0 && measured <= 1 ? measured * 100 : null)
      if (failed) setError(current.current.retryUncertain ? '上次重试结果尚未确认，请继续查询原任务，不会重复发送重试。' : result.status.message || '处理未完成，来源与任务编号已保留')
      else { setMessage(result.status.message || '正在整理笔记，返回后可继续查看进度'); schedule() }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '进度查询失败，点击重新查询') }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  useEffect(() => {
    let active = true
    mounted.current = true
    setReady(false)
    setError('')
    void (async () => {
      const account = await readAccountId()
      if (!account) throw new Error('请重新登录')
      owner.current = account
      const value = await readIntake(account)
      if (recoveryTarget && !sameIntakeHistoryTarget(recoveryTarget, intakeHistoryRecord(account, value, generationBaseUrl)?.target)) throw new Error('原来源任务或账号已变化，请返回处理历史重新核对。不会打开另一份来源或重新提交。')
      if (initialFile) await verifyLocalFile(initialFile)
      if (!active || !mounted.current) return
      const pending = value.taskId || value.operationId || value.uncertain
      const next = !pending && initialFile && !value.file && !value.url ? { mode: 'file' as const, url: '', file: initialFile } : pending ? value : { ...value, mode: initialMode }
      accept(next)
      if (next !== value) await writeIntake(account, next)
      if (!active || !mounted.current) return
      setReady(true)
      if (value.taskId || value.operationId) void query.current()
    })().catch(cause => { if (active && mounted.current) setError(cause.message) })
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && (current.current.taskId || current.current.operationId) && !saved.current) void query.current()
      else if (timer.current) { clearTimeout(timer.current); timer.current = null }
    })
    return () => { active = false; mounted.current = false; modelSequence.current++; modelSheetOpen.current = false; if (timer.current) clearTimeout(timer.current); subscription.remove() }
  }, [prepareAttempt, recoveryTarget])
  useEffect(() => {
    if (!ready) return
    let active = true
    const account = owner.current
    setServiceState('checking'); setServiceError(''); setUploadLimit(null); setVideoLinksAvailable(null)
    const guard = () => { if (!active || !mounted.current || owner.current !== account) throw new Error('页面或账号已变化') }
    void verifyContentService(account, guard).then(capabilities => {
      if (active && mounted.current) { setUploadLimit(capabilities.max_upload_bytes); setVideoLinksAvailable(capabilities.video_url); setServiceState('ready') }
    }).catch((cause: { code?: string; status?: number }) => {
      if (!active || !mounted.current) return
      setServiceState('failed')
      setServiceError(cause.status === 401 ? '请重新登录后检查服务。' : cause.status === 403 ? '当前账号暂不能使用此服务，请联系管理员。' :
        cause.code === 'CONTENT_SERVICE_DISABLED' || cause.code === 'INTEGRATION_NOT_CONFIGURED' ? '服务尚未启用，请联系管理员。' :
        cause.code === 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED' ? '服务需要更新，请联系管理员。' : '暂时无法连接服务，请稍后重试。')
    })
    return () => { active = false }
  }, [ready, prepareAttempt, serviceAttempt])
  const leave = () => {
    if (modelSheetOpen.current) { closeModels(); return }
    if (locked.current) return
    if (!ready) { onBack(); return }
    void persist().then(onBack).catch(cause => setError(`来源尚未保存：${cause.message}`))
  }
  useEffect(() => { const handler = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true }); return () => handler.remove() }, [ready, onBack])
  const submit = async () => {
    if (locked.current || !ready || (!current.current.operationId && !current.current.uncertain && (serviceState !== 'ready' || videoLinkBlocked || fileTooLarge))) return
    locked.current = true; setBusy(true); setError(''); setTerminal(false); setMessage('正在提交来源，请保留此页')
    try {
      await persist()
      const receipt = await submitIntake(owner.current, current.current)
      if (!mounted.current) return
      accept(receipt); await persist()
      if (receipt.receiptState === 'reserved') setMessage('提交已登记，尚未确认排队。请继续核验原提交，不会自动重新派发。')
      else { setMessage('任务已接收，正在整理笔记'); schedule() }
    } catch (cause) {
      if (mounted.current) {
        const persisted = current.current.taskId ? current.current : await readIntake(owner.current).catch(() => current.current)
        accept(persisted); setMessage(''); setError(cause instanceof Error ? cause.message : '提交未确认，请检查连接')
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const start = () => {
    if (draft.uncertain || draft.operationId) void query.current()
    else void submit()
  }
  const choose = async () => {
    if (locked.current || draft.operationId || draft.uncertain) return
    locked.current = true; setBusy(true); setError(''); setMessage('')
    try { const file = await importLocalFile({ keepAudioInFiles: true, purpose: 'note', expectedOwner: owner.current }); if (file && mounted.current) { intakeSourceType(file); accept({ ...current.current, file }); await persist() } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '文件选择失败') }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const openModels = async () => {
    if (modelPosting.current || current.current.retryUncertain) return
    const sequence = ++modelSequence.current
    modelSheetOpen.current = true; setModelSheet(true); setModelLoading(true); setModelError(''); setModelContext(null)
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    try {
      const binding = bindIntakeModel(owner.current, current.current)
      modelBinding.current = binding
      const live = () => {
        if (!mounted.current || !modelSheetOpen.current || modelSequence.current !== sequence) throw new Error('恢复面板已关闭，请重新读取。')
        guardIntakeModel(binding, current.current)
      }
      const context = await readIntakeModelContext(binding, current.current, live)
      live()
      if (!context.requires_confirmation && current.current.modelConfirmationRequired) {
        const next = { ...current.current, modelConfirmationRequired: false }
        await writeIntake(binding.owner, next); live(); accept(next)
      }
      setModelContext(context)
    } catch (cause) {
      if (mounted.current && modelSheetOpen.current && modelSequence.current === sequence) setModelError(cause instanceof Error ? cause.message : '无法读取模型恢复信息')
    } finally { if (mounted.current && modelSequence.current === sequence) setModelLoading(false) }
  }
  const dispatchRetry = async (binding: IntakeModelBinding, context?: IntakeModelContext) => {
    const live = () => {
      if (!mounted.current) throw new Error('页面已关闭，未继续发送。')
      guardIntakeModel(binding, current.current)
    }
    await verifyIntakeModel(binding, current.current); live()
    // Save unknown intent before dispatch. It survives leaving/reopening the page.
    const intent = { ...current.current, retryUncertain: true }
    await writeIntake(binding.owner, intent); live(); accept(intent)
    await verifyIntakeModel(binding, current.current); live()
    try {
      const response = await integrationJson<{ task_id?: string; status?: string }>(`/api/task/${encodeURIComponent(binding.taskId)}/retry`, {
        method: 'POST', ...(context?.selection ? { body: JSON.stringify({ confirmed: true, ...context.selection }) } : {}),
      }, binding.owner, 45000, live)
      live(); await verifyIntakeModel(binding, current.current); live()
      if (response?.task_id !== binding.taskId || !['preparing', 'uploaded', 'processing', 'downloading', 'transcribing', 'summarizing', 'success'].includes(response.status || '')) throw new Error('重试回执无法核验，请只查询原任务。')
      const acknowledged = { ...current.current, retryUncertain: false, modelConfirmationRequired: false }
      await writeIntake(binding.owner, acknowledged); live(); accept(acknowledged)
      setTerminal(false); setRetryable(false)
    } catch (cause) {
      // Only explicit pre-dispatch rejection permits another confirmed attempt.
      if (cause instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(cause.status)) {
        live(); await verifyIntakeModel(binding, current.current); live()
        const rejected = { ...current.current, retryUncertain: false, modelConfirmationRequired: cause.status === 409 || current.current.modelConfirmationRequired }
        await writeIntake(binding.owner, rejected); live(); accept(rejected)
      }
      throw cause
    }
  }
  const confirmModels = async () => {
    const binding = modelBinding.current, context = modelContext
    if (locked.current || modelPosting.current || !binding || !context?.requires_confirmation || !context.can_confirm || !context.selection || current.current.retryUncertain) return
    const sequence = modelSequence.current
    locked.current = true; modelPosting.current = true; setModelSending(true); setBusy(true); setModelError('')
    try {
      const live = () => {
        if (!mounted.current || !modelSheetOpen.current || modelSequence.current !== sequence) throw new Error('恢复信息已变化，请重新读取。')
        guardIntakeModel(binding, current.current)
      }
      const fresh = await readIntakeModelContext(binding, current.current, live)
      if (!sameIntakeModelContext(context, fresh)) {
        setModelContext(fresh); setModelError('服务或模型已变化，请重新核对以上信息后明确确认。'); return
      }
      const task = await inspectIntake(binding.owner, current.current)
      await verifyIntakeModel(binding, current.current); live()
      if (task.note) { modelPosting.current = false; closeModels(); saved.current = true; onSaved(task.note.id); return }
      if (!['failed', 'error'].includes(task.status.status) || !task.status.retryable) {
        modelPosting.current = false; closeModels(); setRetryable(false); setMessage('原任务状态已变化，请重新查询原结果。'); schedule(); return
      }
      await dispatchRetry(binding, fresh)
      modelPosting.current = false; closeModels(); setError(''); setMessage('重试已接收，正在查询原任务。'); schedule()
    } catch (cause) {
      if (mounted.current) {
        setModelContext(null)
        setModelError(current.current.retryUncertain ? '重试结果尚未确认，请返回查询原任务，不会再次发送。' : cause instanceof Error ? cause.message : '恢复失败，原任务保留')
        setRetryable(!current.current.retryUncertain)
      }
    } finally { locked.current = false; modelPosting.current = false; if (mounted.current) { setModelSending(false); setBusy(false) } }
  }
  const retry = async () => {
    if (locked.current || !draft.taskId || !retryable || draft.receiptState === 'reserved') return
    if (draft.retryUncertain) { void query.current(); return }
    if (draft.modelConfirmationRequired) { await openModels(); return }
    locked.current = true; setBusy(true); setError('')
    let confirmationNeeded = false
    try {
      const binding = bindIntakeModel(owner.current, draft)
      await verifyIntakeModel(binding, current.current)
      const currentTask = await inspectIntake(binding.owner, draft)
      await verifyIntakeModel(binding, current.current)
      if (!mounted.current) return
      if (currentTask.note) { saved.current = true; onSaved(currentTask.note.id); return }
      if (!['failed', 'error'].includes(currentTask.status.status) || !currentTask.status.retryable) { setRetryable(false); setTerminal(false); setMessage(currentTask.status.message || '已重新读取原任务状态'); schedule(); return }
      await dispatchRetry(binding); schedule()
    } catch (cause) {
      confirmationNeeded = cause instanceof ApiError && cause.status === 409 && !current.current.retryUncertain
      if (mounted.current) { setError(current.current.retryUncertain ? '重试结果尚未确认，请继续查询原任务，不会重复发送。' : cause instanceof Error ? cause.message : '恢复失败，原任务保留'); if (current.current.retryUncertain) setRetryable(false) }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
    if (confirmationNeeded && mounted.current) await openModels()
  }
  const changeSource = () => Alert.alert('保留原任务，整理另一份内容？', '原任务不会被取消，已保存笔记和原文件也不会删除。', [{ text: '取消', style: 'cancel' }, { text: '更换来源', onPress: () => void writeIntake(owner.current, empty).then(() => { if (timer.current) clearTimeout(timer.current); accept(empty); setTerminal(false); setError(''); setMessage('') }).catch(cause => setError(cause.message)) }])
  const useLibraryFile = () => {
    if (!initialFile || locked.current || !ready) return
    Alert.alert('使用文件库中的文件？', draft.taskId || draft.operationId || draft.uncertain ? '原任务保留在处理历史中，不会取消或再次提交。此文件需要你另行点击生成。' : '将当前未提交来源切换到所选文件，原始文件保留。', [{ text: '保留当前来源', style: 'cancel' }, { text: '使用此文件', onPress: () => {
      locked.current = true; setBusy(true)
      const next: IntakeDraft = { mode: 'file', url: '', file: initialFile }
      void writeIntake(owner.current, next).then(() => { if (!mounted.current) return; if (timer.current) clearTimeout(timer.current); accept(next); saved.current = false; setRecoveredNoteId(''); setTerminal(false); setRetryable(false); setError(''); setMessage('文件已选好，点击生成后才开始处理。') }).catch(cause => { if (mounted.current) setError(cause.message) }).finally(() => { locked.current = false; if (mounted.current) setBusy(false) })
    } }])
  }
  const awaitingLibraryChoice = !!initialFile && draft.file?.id !== initialFile.id && !continueExisting
  const fileLimit = uploadLimit === null ? null : Math.min(uploadLimit, draft.file && ['pdf', 'docx'].includes(draft.file.extension || '') ? 20 * 1024 * 1024 : Infinity)
  const fileTooLarge = draft.mode === 'file' && draft.file && 'size' in draft.file && fileLimit !== null && draft.file.size > fileLimit
  const videoLinkBlocked = draft.mode === 'url' && videoLinksAvailable === false && isExplicitVideoUrl(draft.url)
  return <View style={styles.screen}>
    <ScreenHeader title="链接或文件转笔记" onBack={leave} backLabel={backLabel} disabled={busy} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 20 }}>
      {!draft.taskId && <Text style={styles.subtitle}>选择来源，生成可编辑的笔记。原文件保留在文件库。</Text>}
      {ready && <View style={{ gap: 8 }}>
        <AsyncState loading={serviceState === 'checking'} loadingLabel="正在检查服务…" error={serviceError} onRetry={() => setServiceAttempt(value => value + 1)} retryLabel="重新检查服务" />
        {serviceState === 'ready' && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>内容服务已就绪</Text>}
      </View>}
      {awaitingLibraryChoice && <View style={styles.card}><Text style={styles.noteTitle}>所选文件：{initialFile!.name}</Text><Text style={styles.subtitle}>另有一份来源已保留：{draft.file ? intakeFileName(draft.file) : draft.url || '原提交'}。请选择要继续的内容，尚未提交所选文件。</Text><PrimaryButton title="使用文件库中的文件" disabled={busy || !ready} onPress={useLibraryFile} /><PrimaryButton secondary title="继续原来源" disabled={busy || !ready} onPress={() => setContinueExisting(true)} /></View>}
      {!!recoveredNoteId && <PrimaryButton secondary title="查看原任务生成的笔记" onPress={() => onSaved(recoveredNoteId)} />}
      {!awaitingLibraryChoice && !draft.taskId && <>
        <View style={{ flexDirection: 'row', gap: 8 }}>{(['url', 'file'] as const).map(mode => <Pressable key={mode} accessibilityRole="tab" accessibilityState={{ selected: draft.mode === mode }} disabled={busy || !ready || !!draft.operationId || draft.uncertain} onPress={() => { accept({ ...draft, mode }); setError(''); setMessage('') }} style={{ minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: draft.mode === mode ? colors.primarySoft : colors.card }}><Text style={styles.noteTitle}>{mode === 'url' ? (videoLinksAvailable === true ? '网页或视频链接' : '网页或文档链接') : '本地文件'}</Text></Pressable>)}</View>
        {draft.mode === 'url' ? <View style={{ gap: 10 }}><Field label={videoLinksAvailable === true ? "网页或视频链接" : "网页或文档链接"} value={draft.url} editable={!busy && ready && !draft.operationId && !draft.uncertain} multiline onChangeText={url => accept({ ...draft, url })} placeholder={videoLinksAvailable === true ? "粘贴网页、视频或文档链接" : "粘贴网页、PDF 或 Word 链接"} /><Text style={styles.subtitle}>{videoLinksAvailable === true ? '支持普通网页、公开视频、PDF 和 DOCX 文档链接。' : '支持普通网页、PDF 和 DOCX 文档链接；视频或音频请导入文件。'}登录或动态网页请导出文件再导入。</Text></View>
          : <View style={[styles.card, { gap: 12 }]}><Text style={styles.noteTitle}>{draft.file ? intakeFileName(draft.file) : '选择要整理的文件'}</Text><Text style={styles.subtitle}>PDF、Word DOCX、音视频、文字与字幕。{uploadLimit !== null ? `上传限 ${Math.floor(uploadLimit / 1024 / 1024)} MB；PDF 和 Word 限 ${Math.floor(Math.min(uploadLimit, 20 * 1024 * 1024) / 1024 / 1024)} MB。` : '文件上限将在服务检查后显示。'}PDF 限 200 页；扫描 PDF 请先识别文字。选择后先保存在文件库，点击生成才上传处理。</Text><PrimaryButton secondary title={draft.file ? '重新选择文件' : '选择文件'} disabled={busy || !ready || !!draft.operationId || draft.uncertain} onPress={() => void choose()} /></View>}
      </>}
      {!!fileTooLarge && <AsyncState error={`当前文件超过 ${Math.floor(fileLimit! / 1024 / 1024)} MB 上限，请另选文件。原文件仍保留。`} />}
      {videoLinkBlocked && <AsyncState error="暂不支持视频或音频链接，请下载后导入文件。" />}
      {!awaitingLibraryChoice && draft.taskId && <>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.noteTitle}>{draft.retryUncertain ? '原任务重试结果待确认' : terminal ? '处理未完成，原来源保留' : '正在整理笔记'}</Text>
        {!terminal && <ProcessingProgress label="整理笔记" percent={taskProgress} unknownLabel="正在查询原任务，暂未提供可计量进度" />}

      </>}
      {__DEV__ && (draft.operationId || draft.taskId || error) && <View style={{ gap: 8 }}><PrimaryButton tertiary title={diagnosticsOpen ? '收起开发诊断' : '开发诊断'} onPress={() => setDiagnosticsOpen(value => !value)} />{diagnosticsOpen && <View style={{ gap: 4 }}>{draft.operationId && <Text selectable style={styles.subtitle}>提交编号：{draft.operationId}</Text>}{draft.taskId && <Text selectable style={styles.subtitle}>任务编号：{draft.taskId}</Text>}<Text style={styles.subtitle}>网页与 PDF/DOCX 支持原提交回执核验；视频、音频和逐字稿尚未支持提交去重。</Text>{!!error && <Text selectable style={styles.subtitle}>{error}</Text>}</View>}</View>}
      {(draft.operationId || draft.uncertain) && !draft.taskId && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>处理状态：提交待确认。保存位置：笔记。来源已保留，请查询原任务，不会自动重复提交。</Text>}
      <AsyncState loading={!draft.taskId && (busy || (!ready && !error))} loadingLabel={draft.taskId ? '正在查询原任务…' : sourceRecoveryCopy(message) || '正在准备来源…'} error={sourceRecoveryCopy(error)} />
      {!ready && !!error && <PrimaryButton secondary title="重新读取来源" onPress={() => setPrepareAttempt(value => value + 1)} />}
      {!draft.taskId && !busy && message && !error && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{sourceRecoveryCopy(message)}</Text>}
      {!awaitingLibraryChoice && (draft.taskId ? <View style={{ gap: 10 }}><PrimaryButton title={draft.receiptState === 'reserved' ? '核验原提交' : '重新查询结果'} disabled={busy} onPress={() => void query.current()} />{retryable && <PrimaryButton secondary title={draft.modelConfirmationRequired ? "确认模型并恢复原任务" : "重试处理原任务"} disabled={busy} onPress={() => void retry()} />}{terminal && <PrimaryButton tertiary title="更换来源" disabled={busy} onPress={changeSource} />}</View>
        : <PrimaryButton title={draft.uncertain || draft.operationId ? '核验原提交' : '生成总结笔记'} loading={busy} disabled={!ready || (!draft.operationId && !draft.uncertain && (serviceState !== 'ready' || !!fileTooLarge || videoLinkBlocked || (draft.mode === 'url' ? !draft.url.trim() : !draft.file)))} onPress={start} />)}
      {!awaitingLibraryChoice && draft.taskId && <DetailDisclosure key={`source-${draft.generationOrigin}-${draft.operationId}-${draft.taskId}`} title="来源与保存位置">
          <Text style={styles.subtitle}>{draft.mode === 'url' ? draft.url || '已提交的链接' : draft.file ? intakeFileName(draft.file) : '已提交的文件'}</Text>
          <Text style={styles.subtitle}>保存位置：笔记。返回后仍查询同一任务。</Text>
        </DetailDisclosure>}
      {draft.taskId && <DetailDisclosure key={`processing-${draft.generationOrigin}-${draft.operationId}-${draft.taskId}`} title="处理详情">
        {message && <Text style={styles.subtitle}>{sourceRecoveryCopy(message)}</Text>}
        <Text style={styles.subtitle}>查询或重试沿用原来源；未知提交结果只查询，不重复生成。</Text>
      </DetailDisclosure>}
    </ScrollView>
    {modelSheet && <BottomActionSheet visible title="确认原任务处理模型" onClose={closeModels} onBack={closeModels}>
      <Text style={styles.subtitle}>旧任务没有保留模型选择。请核对下面的服务与模型；确认后仅恢复这份原任务。</Text>
      <AsyncState loading={modelLoading || modelSending} loadingLabel={modelSending ? '正在确认并恢复原任务…' : '正在读取原任务恢复信息…'} error={sourceRecoveryCopy(modelError)} />
      {modelContext && <View style={{ gap: 12 }}>
        <Text style={styles.label}>原来源：{modelContext.source.title}</Text>
        <Text selectable style={styles.subtitle}>原任务处理服务：{modelBinding.current?.origin}</Text>
        {modelContext.selection && <><Text selectable style={styles.subtitle}>模型服务：{modelContext.selection.server_url}</Text><Text style={styles.subtitle}>语音转写 ASR：{modelContext.selection.asr_model}</Text><Text style={styles.subtitle}>内容总结 LLM：{modelContext.selection.llm_model}</Text><Text style={styles.subtitle}>以上是服务提供的恢复选择，旧任务原模型无法确认。不会重新上传或更换来源。</Text></>}
        {!modelContext.requires_confirmation && <Text style={styles.subtitle}>原任务已有模型记录，请返回查询状态；如仍失败，可明确重试原任务。</Text>}
        {modelContext.requires_confirmation && !modelContext.can_confirm && <Text style={styles.subtitle}>这些模型当前不能恢复任务。原选择已保留，请稍后重新读取状态。</Text>}
        {modelContext.requires_confirmation && <PrimaryButton title="确认以上模型并重试原任务" disabled={modelLoading || modelSending || !modelContext.can_confirm || !!draft.retryUncertain} loading={modelSending} onPress={() => void confirmModels()} />}
      </View>}
      {!draft.retryUncertain && <PrimaryButton secondary title="重新读取模型恢复信息" disabled={modelLoading || modelSending} onPress={() => void openModels()} />}
      <PrimaryButton tertiary title={draft.retryUncertain ? '返回并查询原任务' : '返回原任务'} disabled={modelSending} onPress={() => { closeModels(); if (current.current.retryUncertain) void query.current() }} />
    </BottomActionSheet>}
  </View>
}
