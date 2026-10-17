import React, { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { Text } from './AppText'
import { deliveryById, deliveryByOperation, deliveryStatus, type Delivery } from '../lib/feishu'
import { readPublishDraft } from '../lib/feishuPublishReceipt'
import { readRetryReceipt } from '../lib/feishuRetryReceipt'
import { useSessionGate } from '../lib/useSessionGate'
import { assertRemoteScope, captureRemoteScope, SessionGateError } from '../lib/sessionGate'
import { identityEpoch } from '../lib/sessionIdentity'
import { feishuFormattingMessage } from '../lib/feishuFormatting'
import { colors, styles } from '../design-system/theme'

export function FeishuDocumentFooter({ noteId, refreshKey, onDelivery, onSettings }: { noteId: string; refreshKey: string; onDelivery: () => void; onSettings?: () => void }) {
  const [storedJob, setJob] = useState<Delivery | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const gate = useSessionGate()
  const boundEpoch = useRef(identityEpoch())
  const currentNote = useRef(noteId)
  const currentRefresh = useRef(refreshKey)
  const target = useRef<{ jobId?: string; operationId?: string; sourceKnown: boolean; pending: boolean } | null>(null)
  const [sourceKnown, setSourceKnown] = useState(false)
  const [pending, setPending] = useState(false)
  // An existing content view must never rebind to B or to a later A epoch.
  const sameIdentity = boundEpoch.current === identityEpoch()
  const job = sameIdentity ? storedJob : null
  useEffect(() => {
    let active = true
    if (currentNote.current !== noteId) {
      currentNote.current = noteId; target.current = null; setJob(null); setSourceKnown(false); setPending(false)
    }
    if (currentRefresh.current !== refreshKey) {
      currentRefresh.current = refreshKey; target.current = null; setSourceKnown(false)
    }
    if (!sameIdentity || gate.mode !== 'verified' || gate.scope?.epoch !== boundEpoch.current) {
      setBusy(false)
      setError(sameIdentity ? new SessionGateError().message : '账号已切换，原发布状态保留；请返回当前账号的内容。')
      return () => { active = false }
    }
    const scope = captureRemoteScope(gate.scope.owner)
    const guard = () => {
      if (!active || identityEpoch() !== boundEpoch.current) throw new Error('原状态读取已停止')
      assertRemoteScope(scope)
    }
    setBusy(true); setError('')
    void (async () => {
      // Read-only recovery: neither helper that acknowledges a publication nor
      // the retry observer is called here. Unknown markers remain untouched.
      const retry = await readRetryReceipt(scope.owner, noteId); guard()
      const draft = await readPublishDraft(scope.owner, noteId); guard()
      let selected = target.current
      if (!selected) {
        selected = retry
          ? { jobId: retry.jobId, sourceKnown: draft?.state === 'acknowledged' && draft.jobId === retry.jobId, pending: true }
          : draft && draft.state !== 'draft'
            ? { jobId: draft.jobId, operationId: draft.operationId, sourceKnown: draft.state === 'acknowledged', pending: draft.state === 'unknown' }
            : null
        target.current = selected
      } else if (retry) {
        if (selected.jobId !== retry.jobId) throw new Error('待核验重试与原发布任务不一致，请查看原发布状态')
        selected = { ...selected, pending: true }; target.current = selected
      }
      setSourceKnown(selected?.sourceKnown ?? false); setPending(selected?.pending ?? false)
      const next = selected?.jobId
        ? await deliveryById(selected.jobId, scope.owner)
        : selected?.operationId
          ? await deliveryByOperation(selected.operationId, scope.owner)
          : await deliveryStatus(noteId, scope.owner)
      guard()
      if (selected && (!next?.id || (selected.jobId ? next.id !== selected.jobId : next.operation_id !== selected.operationId))) throw new Error('返回回执不属于原发布操作')
      if (!selected && next?.id) target.current = { jobId: next.id, sourceKnown: false, pending: false }
      setJob(next)
    })().catch(cause => {
      try { guard(); setError(cause instanceof Error ? cause.message : '飞书状态读取失败') } catch { /* Stale lease/owner cannot update this view. */ }
    }).finally(() => { try { guard(); setBusy(false) } catch { /* The next gate effect owns loading. */ } })
    return () => { active = false }
  }, [noteId, refreshKey, attempt, gate, sameIdentity])
  if (!busy && !error && !job) return null
  const visiblePending = sameIdentity && pending
  const unknown = visiblePending || ['unknown', 'permission_unknown'].includes(job?.phase || '') || job?.needs_document_recovery || Object.values(job?.recipients || {}).some(recipient => ['unknown', 'permission_unknown', 'sending'].includes(recipient.status) || ['unknown', 'granting'].includes(recipient.reading_permission?.status || ''))
  const phases: Record<string, string> = { awaiting_authorization: '等待授权', pending_create: '等待创建文档', writing: '正在写入正文', setting_permissions: '正在核验文档权限', notifying: '正在发送通知', partial_success: '部分步骤尚未完成', unknown: '发布结果待核验' }
  const status = unknown ? '发布结果待核验' : job?.status === 'completed' ? '已发布' : job?.status === 'failed' ? `${phases[job.phase || ''] || '发布'} · 需处理` : phases[job?.phase || ''] || '正在发布'
  const needsReview = visiblePending || (!!job && (unknown || job.status !== 'completed' || !!job.error))
  const configurationError = /授权|配置|FEISHU_NOT_CONFIGURED|EXPIRED/.test(error)
  return <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14, gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={[styles.subtitle, { flex: 1 }]}>{visiblePending ? '飞书发布结果待核验' : job ? `飞书文档 · ${status}${error ? ' · 更新未确认' : ''}` : busy ? '正在读取飞书发布状态…' : '飞书发布状态未确认'}</Text>
      {!!job?.document_url && <Pressable accessibilityRole="button" accessibilityLabel="查看已发布飞书文档" onPress={() => { if (!/^https:\/\/[a-z0-9.-]+\.feishu\.cn\//.test(job.document_url)) { setError('飞书链接无效'); return }; void Linking.openURL(job.document_url).catch(() => setError('文档未打开，请重试')) }} style={styles.textButton}><Text style={styles.link}>查看文档 ↗</Text></Pressable>}
    </View>
    {!!error && <><Text accessibilityRole="alert" style={[styles.subtitle, { color: colors.danger }]}>{error}</Text><View style={{ flexDirection: 'row', gap: 12 }}><Pressable accessibilityRole="button" disabled={busy} onPress={() => setAttempt(value => value + 1)} style={styles.textButton}><Text style={styles.link}>重新读取</Text></Pressable>{configurationError && onSettings && <Pressable accessibilityRole="button" onPress={onSettings} style={styles.textButton}><Text style={styles.link}>检查飞书连接</Text></Pressable>}</View></>}
    {needsReview && <Pressable accessibilityRole="button" accessibilityLabel="查看发布状态" onPress={() => { if (identityEpoch() === boundEpoch.current) onDelivery() }} style={styles.textButton}><Text style={styles.link}>查看发布状态</Text></Pressable>}
    {(job || visiblePending) && <Text style={styles.subtitle}>{feishuFormattingMessage(sourceKnown && !visiblePending && !busy && !error && !unknown ? job?.formatting : undefined, job?.status)}</Text>}
    {!!job?.error && <Text style={styles.subtitle}>{job.error}</Text>}
  </View>
}
