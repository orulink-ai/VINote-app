import { feishuVerificationUnavailable, feishuVerificationMessage } from '../lib/feishuConnectionState'
import { Text } from './AppText'
import React, { useEffect, useRef, useState } from 'react'
import { Linking, TextInput, View } from 'react-native'
import {
  deliveryStatus,
  publishToFeishu,
  assertFeishuPublishReady,
  retryDelivery,
  recoverDeliveryDocument,
  type Delivery,
  feishuApi,
  type FeishuStatus,
  type PublishOptions,
  feishuContacts,
  contactsValid,
  contactRecipients,
  type FeishuContact,
  type FeishuGroup,
  newSnapshotPublishOptions,
  verifyDeliveryPermissions,
} from '../lib/feishu'
import { PrimaryButton } from './PrimaryButton'
import { colors, styles } from '../design-system/theme'
import type { Note } from '../types/api'
import { FeishuDestinationPicker } from './FeishuDestinationPicker'
import { SettingsCheckbox } from './SettingsCheckbox'
import { readAccountId } from '../lib/storage'
import { newPublishDraft, readPublishDraft, persistPublishDraft, queryPublishReceipt, type PublishDraft } from '../lib/feishuPublishReceipt'
import { hasPublishReview, reviewPublishOptions, type PublishReview } from '../lib/feishuPublishReview'
import { deliverySettingsReturn, type FeishuDeliveryReturn } from '../lib/feishuDeliveryReturn'
import { DetailDisclosure } from './DetailDisclosure'
import { MeetingMarkdown } from './MeetingMarkdown'
import { beginRetryReceipt, readRetryReceipt, queryRetryReceipt, type RetryReceipt } from '../lib/feishuRetryReceipt'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { feishuFormattingMessage } from '../lib/feishuFormatting'
import { beginPublishAttempt, restoreUndispatchedPublish } from '../lib/feishuPublishReceipt'
import { publishOptionsSignature } from '../lib/feishuPublishReview'
import { integrationBaseUrl } from '../lib/integration'
import { createConnectorPluginStore } from '../lib/connectorPlugins'
import Storage from '@react-native-async-storage/async-storage'
import { BottomActionSheetFooter } from './BottomActionSheet'

const permissionLabels: Record<string, string> = { verified: '已核验', pending: '尚未核验', failed: '权限未通过核验', legacy_unverified: '旧记录未核验', unverified: '尚未核验', unknown: '权限结果未知' }
const recipientLabels: Record<string, string> = { pending: '待发送', sending: '正在发送，送达尚未确认', sent: '已发送，实际阅读未确认', failed: '发送失败', unknown: '结果未知，请核对，不能盲目重发', permission_unknown: '阅读权限结果未知，先查询原任务' }

export function FeishuDeliveryPanel({
  note,
  onSettings,
  returnedFromSettings = false,
}: {
  note: Note
  onSettings?: (resume?: FeishuDeliveryReturn) => void
  returnedFromSettings?: boolean
}) {
  const [job, setJob] = useState<Delivery | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryUrl, setRecoveryUrl] = useState('')
  const [loadedNote, setLoadedNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [options, setRawOptions] = useState<PublishOptions>({ destination_config: { kind: 'personal' }, permission_policy: 'private', notify_self: false, groups: [] })
  const setOptions: React.Dispatch<React.SetStateAction<PublishOptions>> = next => setRawOptions(previous => {
    const value = typeof next === 'function' ? next(previous) : next
    return !receiptRef.current || receiptRef.current.publicationKey && receiptRef.current.state === 'draft' ? newSnapshotPublishOptions(value) : value
  })
  const [pluginReady, setPluginReady] = useState<boolean | null>(null)
  const [pluginError, setPluginError] = useState('')
  const [loadedOwner, setLoadedOwner] = useState('')
  const [objectBinding, setObjectBinding] = useState('')
  const [objectReview, setObjectReview] = useState<PublishReview>()
  const [reviewError, setReviewError] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const objectSequence = useRef(0)
  const initialized = useRef(false)
  const requestSequence = useRef(0)
  const [receipt, setReceipt] = useState<PublishDraft | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<FeishuStatus | null>(null)
  const verificationUnavailable = feishuVerificationUnavailable(connectionStatus)
  const [receiptSupported, setReceiptSupported] = useState<boolean | null>(null)
  const [sessionEpoch, setSessionEpoch] = useState(identityEpoch)
  const [contactSupported, setContactSupported] = useState<boolean | null>(null)
  const [contactProtocol, setContactProtocol] = useState<boolean | null>(null)
  const [contactQuery, setContactQuery] = useState('')
  const [contactItems, setContactItems] = useState<FeishuContact[]>([])
  const [contactPage, setContactPage] = useState('')
  const [contactHasMore, setContactHasMore] = useState(false)
  const [contactLoaded, setContactLoaded] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactError, setContactError] = useState('')
  const contactSequence = useRef(0), groupSequence = useRef(0)
  const contactAttempt = useRef({ query: '', page: '', append: false })
  const [groups, setGroups] = useState<FeishuGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [retryPending, setRetryPending] = useState<RetryReceipt | null>(null)
  const actionLock = useRef(false)
  const receiptRef = useRef<PublishDraft | null>(null)
  const remember = (value: PublishDraft | null) => { receiptRef.current = value; setReceipt(value) }
  const permissionUncertain = job?.phase === 'permission_unknown' || Object.values(job?.recipients || {}).some(recipient => recipient.status === 'permission_unknown' || ['unknown', 'granting'].includes(recipient.reading_permission?.status || ''))
  const deliveryUncertain = permissionUncertain || job?.phase === 'unknown' || Object.values(job?.recipients || {}).some(recipient => ['unknown', 'sending'].includes(recipient.status))
  const frozen = !!receipt && receipt.state !== 'draft'
  const selectedOptions = frozen ? receipt!.options : options
  const displayedReview = frozen ? receipt!.review : objectReview
  const reviewBinding = JSON.stringify([loadedOwner, sessionEpoch, integrationBaseUrl, note.id,
    receipt?.snapshot.title || note.title, receipt?.snapshot.content || note.content, publishOptionsSignature(options)])
  const reviewBindingRef = useRef(reviewBinding); reviewBindingRef.current = reviewBinding
  const objectsVerified = hasPublishReview(selectedOptions, displayedReview) && (frozen || objectBinding === reviewBinding)
  const notificationNames = [
    ...(selectedOptions.notify_self ? [`${objectsVerified ? displayedReview!.selfName : frozen ? '原收件人姓名未核验' : connectionStatus?.name || '姓名待读取'}（本人）`] : []),
    ...(selectedOptions.groups || []).map(id => (objectsVerified ? displayedReview!.groups.find(group => group.chat_id === id)?.name : groups.find(group => group.chat_id === id)?.name) || '群名称待读取'),
    ...(selectedOptions.contacts || []).map(contact => contact.name || '联系人姓名待读取'),
  ]
  const notificationSummary = notificationNames.join('、') || '不发送'
  const visibleNote = receipt ? { ...note, title: receipt.snapshot.title, content: receipt.snapshot.content } : note
  const publishRevision = receipt ? receipt.snapshot.revisionId : note.workspace_revision
  const ready = loadedNote === note.id
  const completedDocument = ready && !busy && !loading && !retryPending && !deliveryUncertain && !job?.needs_document_recovery &&
    sessionEpoch === identityEpoch() && receipt?.owner === loadedOwner && receipt?.origin === integrationBaseUrl &&
    receipt?.state === 'acknowledged' && receipt.jobId === job?.id && job?.status === 'completed' && !!job.document_url
  const openCompletedDocument = async () => {
    if (!completedDocument || !job || !receipt || sessionEpoch !== identityEpoch()) return
    const epoch = identityEpoch(), sequence = requestSequence.current, operation = receipt.operationId, id = job.id, url = job.document_url
    try {
      const owner = await readAccountId()
      if (epoch !== identityEpoch() || sequence !== requestSequence.current || owner !== loadedOwner ||
          receiptRef.current?.owner !== owner || receiptRef.current.operationId !== operation ||
          receiptRef.current.state !== 'acknowledged' || receiptRef.current.jobId !== id || receiptRef.current.origin !== integrationBaseUrl) return
      await Linking.openURL(url)
    } catch (cause) { if (epoch === identityEpoch() && sequence === requestSequence.current) setError((cause as Error).message) }
  }
  const selectionDisabled = verificationUnavailable || !ready || frozen || !!retryPending || busy || loading || reviewBusy || ['queued', 'processing'].includes(job?.status || '')
  useEffect(() => subscribeIdentity(() => {
    requestSequence.current++; objectSequence.current++; contactSequence.current++; groupSequence.current++;
    setSessionEpoch(identityEpoch())
  }), [])
  const load = async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setReceiptSupported(null)
    try {
      const owner = await readAccountId()
      if (!owner) throw new Error('请重新登录')
      const pending = await readRetryReceipt(owner, note.workspace_key || note.id)
      if (sequence !== requestSequence.current) return
      setRetryPending(pending)
      const saved = await readPublishDraft(owner, note.workspace_key || note.id)
      if (sequence !== requestSequence.current) return
      if (saved) { remember(saved); setOptions(saved.options); setObjectReview(returnedFromSettings && saved.state === 'draft' ? undefined : saved.review); initialized.current = true }
      const settings = await feishuApi<FeishuStatus>('/status', {}, owner)
      if (sequence !== requestSequence.current) return
      setConnectionStatus(settings)
      setLoadedOwner(owner)
      try {
        await assertFeishuPublishReady(owner)
        if (sequence !== requestSequence.current) return
        setPluginReady(true); setPluginError('')
      } catch (cause) {
        if (sequence !== requestSequence.current) return
        setPluginReady(false); setPluginError((cause as Error).message)
      }
      setReceiptSupported(settings.publish_receipt_protocol === 1)
      setContactProtocol(settings.contact_selection_protocol === 1)
      setContactSupported(settings.contact_selection_protocol === 1 && settings.capabilities?.contact_search === true && settings.connected && !settings.expired)
      if (!initialized.current) {
        setOptions({ destination_config: settings.destination_config || { kind: 'personal' }, permission_policy: settings.permission_policy || 'private', notify_self: settings.notify_self, groups: settings.groups })
        initialized.current = true
      }
      const recovered = pending ? await queryRetryReceipt(pending) : null
      const next = !pending && saved && saved.state !== 'draft' ? await queryPublishReceipt(saved) : null
      const latest = recovered ? recovered.job : next ? next.job : await deliveryStatus(note.workspace_key || note.id, owner)
      if (sequence !== requestSequence.current) return
      if (recovered) setRetryPending(recovered.pending)
      if (next) remember(next.draft)
      setJob(latest)
      setLoadedNote(note.id)
      setError('')
    } catch (cause) {
      if (sequence === requestSequence.current) { setError((cause as Error).message); if (receiptRef.current?.state === 'unknown') setLoadedNote(note.id) }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    setJob(null)
    setRetryPending(null)
    remember(null)
    initialized.current = false
    setReceiptSupported(null)
    setConnectionStatus(null)
    setContactProtocol(null); setContactSupported(null)
    setOptions({ destination_config: { kind: 'personal' }, permission_policy: 'private', notify_self: false, groups: [] })
    setContactQuery(''); setContactItems([]); setContactPage(''); setContactHasMore(false); setContactLoaded(false); setContactLoading(false); setContactError('')
    setGroups([]); setGroupsLoaded(false); setGroupsLoading(false); setGroupError('')
    setLoadedNote(null)
    setRecoveryUrl('')
    setPluginReady(null); setPluginError(''); setLoadedOwner(''); setObjectBinding('')
    setObjectReview(undefined); setReviewError(''); setReviewBusy(false)
    setError('')
    setBusy(false)
    void load()
    return () => { requestSequence.current += 1; objectSequence.current += 1; contactSequence.current++; groupSequence.current++ }
  }, [note.id, sessionEpoch])
  useEffect(() => {
    if (!ready || frozen || retryPending || busy || loading) return
    let active = true
    const epoch = identityEpoch()
    void (async () => {
      const owner = await readAccountId()
      if (!owner) throw new Error('请重新登录')
      if (!active || epoch !== identityEpoch()) return
      const existing = receiptRef.current
      const draft = existing || newPublishDraft(owner, note.workspace_key || note.id, { title: note.title, content: note.content, versionId: note.workspace_version_id, revisionId: note.workspace_revision === undefined ? undefined : String(note.workspace_revision) }, options)
      const next = { ...draft, options, review: hasPublishReview(options, objectReview) ? objectReview : undefined }
      await persistPublishDraft(next)
      if (active) remember(next)
    })().catch(cause => { if (active) setError((cause as Error).message) })
    return () => { active = false }
  }, [ready, frozen, retryPending, busy, loading, options, objectReview, note.id])
  const invalidateReview = () => {
    objectSequence.current += 1
    setObjectReview(undefined); setObjectBinding(''); setReviewError(''); setReviewBusy(false)
  }
  const loadGroups = async () => {
    if (selectionDisabled || groupsLoading) return
    const sequence = ++groupSequence.current, request = requestSequence.current, epoch = identityEpoch()
    setGroupsLoading(true); setGroupError('')
    try {
      const owner = await readAccountId()
      if (!owner) throw new Error('请重新登录')
      if (sequence !== groupSequence.current || request !== requestSequence.current || epoch !== identityEpoch()) return
      const result = await feishuApi<FeishuGroup[]>('/groups', {}, owner)
      if (sequence !== groupSequence.current || request !== requestSequence.current || epoch !== identityEpoch() || await readAccountId() !== owner) return
      if (!Array.isArray(result)) throw new Error('群列表响应未核验')
      setGroups(result); setGroupsLoaded(true)
    } catch (cause) { if (sequence === groupSequence.current) setGroupError((cause as Error).message) }
    finally { if (sequence === groupSequence.current) setGroupsLoading(false) }
  }
  const searchContacts = async (attempt = { query: contactQuery.trim(), page: '', append: false }) => {
    if (selectionDisabled || !contactSupported || contactLoading || !attempt.query) return
    const sequence = ++contactSequence.current, request = requestSequence.current, epoch = identityEpoch()
    contactAttempt.current = attempt
    setContactLoading(true); setContactError('')
    try {
      const owner = await readAccountId()
      if (!owner) throw new Error('请重新登录')
      if (sequence !== contactSequence.current || request !== requestSequence.current || epoch !== identityEpoch()) return
      const result = await feishuContacts(attempt.query, attempt.page, owner)
      if (sequence !== contactSequence.current || request !== requestSequence.current || epoch !== identityEpoch() || await readAccountId() !== owner) return
      setContactItems(previous => Array.from(new Map([...(attempt.append ? previous : []), ...result.items].map(item => [item.open_id, item])).values()))
      setContactPage(result.page_token); setContactHasMore(result.has_more); setContactLoaded(true)
    } catch (cause) { if (sequence === contactSequence.current) setContactError((cause as Error).message) }
    finally { if (sequence === contactSequence.current) setContactLoading(false) }
  }
  const selectContact = (contact: FeishuContact, selected: boolean) => {
    if (selectionDisabled || (selected && (!contactSupported || (options.contacts?.length || 0) >= 20))) return
    setOptions(current => ({ ...current, contacts: selected ? [...(current.contacts || []).filter(item => item.open_id !== contact.open_id), contact] : (current.contacts || []).filter(item => item.open_id !== contact.open_id) }))
    invalidateReview()
  }
  const verifyObjects = async () => {
    if (verificationUnavailable || !ready || frozen || !!retryPending || busy || loading || !receiptSupported || pluginReady !== true) return
    const sequence = ++objectSequence.current, request = requestSequence.current, binding = reviewBindingRef.current
    const epoch = identityEpoch(), origin = integrationBaseUrl
    setReviewBusy(true); setObjectReview(undefined); setObjectBinding(''); setReviewError('')
    try {
      const owner = receiptRef.current?.owner ?? await readAccountId()
      if (!owner) throw new Error('请重新登录')
      const result = await reviewPublishOptions(owner, options)
      const currentOwner = await readAccountId()
      if (sequence !== objectSequence.current || request !== requestSequence.current || epoch !== identityEpoch() ||
          origin !== integrationBaseUrl || binding !== reviewBindingRef.current || currentOwner !== owner) return
      setObjectReview(result); setObjectBinding(binding)
    } catch (cause) {
      if (sequence === objectSequence.current && request === requestSequence.current && binding === reviewBindingRef.current && epoch === identityEpoch()) {
        setReviewError(`发布对象未核验：${(cause as Error).message}`)
      }
    } finally { if (sequence === objectSequence.current) setReviewBusy(false) }
  }
  useEffect(() => {
    void verifyObjects()
    return () => { objectSequence.current++ }
  }, [reviewBinding, ready, frozen, !!retryPending, busy, loading, receiptSupported, verificationUnavailable, pluginReady])

  const enablePlugin = async () => {
    if (busy || loading || actionLock.current) return
    const epoch = identityEpoch(), request = requestSequence.current
    setBusy(true); setPluginError('')
    try {
      const owner = await readAccountId()
      const current = () => epoch === identityEpoch() && request === requestSequence.current
      if (!owner || !current() || (loadedOwner && owner !== loadedOwner)) throw new Error('账号已变化，请重新读取')
      const store = createConnectorPluginStore(Storage)
      await store.save(owner, { installed: true, enabled: true }, current)
      const saved = await store.read(owner, current)
      if (!current() || await readAccountId() !== owner || !saved.installed || !saved.enabled) throw new Error('插件启用状态未核验')
      await assertFeishuPublishReady(owner, epoch)
      if (current()) setPluginReady(true)
    } catch (cause) { if (epoch === identityEpoch() && request === requestSequence.current) setPluginError((cause as Error).message) }
    finally { if (epoch === identityEpoch() && request === requestSequence.current) setBusy(false) }
  }
  useEffect(() => {
    if (busy || !job || !['queued', 'processing'].includes(job.status)) return
    const timer = setInterval(() => { if (!loading) void load() }, 5000)
    return () => clearInterval(timer)
  }, [note.id, busy, loading, job?.status])
  const action = async (retry = false, recipients?: string[]) => {
    if (!ready || busy || loading || reviewBusy || !receiptSupported || retryPending || actionLock.current) return
    if (receiptRef.current?.state === 'unknown' || deliveryUncertain) return
    actionLock.current = true
    const epoch = identityEpoch()
    const sequence = ++requestSequence.current
    setBusy(true)
    setError('')
    let attempt: Awaited<ReturnType<typeof beginPublishAttempt>> | undefined
    try {
      const owner = await readAccountId()
      if (!owner) throw new Error('请重新登录')
      if (await readRetryReceipt(owner, note.workspace_key || note.id)) throw new Error('原重试结果尚未确认，请查询原任务')
      const status = await feishuApi<FeishuStatus>('/status', {}, owner)
      if (sequence !== requestSequence.current || epoch !== identityEpoch()) return
      if (status.publish_receipt_protocol !== 1) throw new Error('飞书服务需要升级发布回执协议；尚未发出发布请求，原草稿保留')
      if (feishuVerificationUnavailable(status)) throw new Error(feishuVerificationMessage)
      if (!retry && options.contacts?.length && (status.contact_selection_protocol !== 1 || status.capabilities?.contact_search !== true)) throw new Error('飞书服务尚未支持当前联系人选择，尚未提交；原选择保留')
      if (!retry && options.recipient_access_policy && status.recipient_access_protocol !== 1) throw new Error('飞书服务需要升级收件人阅读权限协议；尚未提交，原选择保留')
      if (!retry && !contactsValid(options.contacts || [])) throw new Error('联系人选择已过期，请移除后重新搜索选择；尚未提交')
      if (!retry && (!objectsVerified || !hasPublishReview(options, objectReview))) throw new Error('位置与通知对象尚未核验，请稍后或重试读取')
      if (!retry && options.notify_self && status.name !== objectReview?.selfName) {
        invalidateReview(); throw new Error('通知本人的飞书身份已变化，请重新核验')
      }
      let intent = receiptRef.current
      if (!retry) {
        await assertFeishuPublishReady(owner, epoch)
        if (sequence !== requestSequence.current || epoch !== identityEpoch()) return
        if (intent && intent.state !== 'draft') throw new Error('请明确准备新的发布草稿；原交付保留')
        intent ??= newPublishDraft(owner, note.workspace_key || note.id, { title: note.title, content: note.content, versionId: note.workspace_version_id, revisionId: note.workspace_revision === undefined ? undefined : String(note.workspace_revision) }, options)
        attempt = await beginPublishAttempt({ ...intent, options, review: objectReview })
        intent = attempt.draft
        if (sequence !== requestSequence.current) return
        remember(intent)
      }
      if (retry) {
        if (!job || job.status !== 'failed') throw new Error('原失败任务尚未核验')
        const pending = await beginRetryReceipt(owner, note.workspace_key || note.id, job.id)
        if (sequence !== requestSequence.current) return
        setRetryPending(pending)
      }
      const next =
        retry && job
          ? await retryDelivery(job.id, recipients, intent?.owner ?? owner)
          : await publishToFeishu(intent!.publicationKey || intent!.noteKey, intent!.snapshot.title, intent!.snapshot.content, false, intent!.owner, { ...intent!.options, ...(intent!.options.contacts ? { contacts: contactRecipients(intent!.options.contacts) } : {}), operation_id: intent!.operationId }, attempt?.attempt)
      if (!next || (retry && next.id !== job!.id) || (!retry && next.operation_id !== intent!.operationId)) throw new Error(retry ? '原重试回执未确认，请查询原任务；不会再次提交' : '原发布回执未确认，请查询原操作；不会自动重新发布')
      if (intent && !retry) { const confirmed = { ...intent, state: 'acknowledged' as const, jobId: next.id }; await persistPublishDraft(confirmed); if (sequence === requestSequence.current) remember(confirmed) }
      if (sequence !== requestSequence.current) return
      setJob(next)
    } catch (cause) {
      if (attempt) {
        try {
          const restored = await restoreUndispatchedPublish(attempt.draft, attempt.attempt, cause)
          if (sequence === requestSequence.current) { remember(restored); setPluginReady(false); setPluginError('本次发布尚未发送，请重新核对插件状态后继续。') }
        } catch { /* No current-attempt proof: preserve the exact unknown without replay. */ }
      } else if ((cause as { code?: string }).code === 'FEISHU_PLUGIN_UNAVAILABLE' && sequence === requestSequence.current) {
        setPluginReady(false); setPluginError((cause as Error).message)
      }
      if (sequence === requestSequence.current) setError((cause as Error).message)
    } finally {
      actionLock.current = false
      if (sequence === requestSequence.current) setBusy(false)
    }
  }
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.noteTitle}>{visibleNote.title}</Text>
      <Text style={styles.subtitle}>飞书账号：{connectionStatus?.connected && !connectionStatus.expired ? connectionStatus.name || '已连接' : '尚未连接或授权已过期'}</Text>
      <Text style={styles.subtitle}>{objectsVerified
        ? `${displayedReview!.destination.path_complete ? '本次位置' : '本次位置 · 已核验路径片段'}：${displayedReview!.destination.path.join(' / ')}${displayedReview!.destination.path_complete ? '' : '（完整祖先路径未核验）'}`
        : frozen ? '原发布位置名称及路径未核验，原目标保持冻结。' : '正在核对本次实际位置。'}</Text>
      {pluginReady === false && <><Text accessibilityRole="alert" style={styles.subtitle}>{pluginError || '飞书插件尚未安装或已停用。'}已有账号授权会保留。</Text><PrimaryButton secondary title="启用飞书插件" disabled={busy || loading || !loadedOwner} onPress={() => void enablePlugin()} /></>}
      {verificationUnavailable && <><Text accessibilityLiveRegion="polite" style={styles.subtitle}>{feishuVerificationMessage}</Text><PrimaryButton secondary title="重新核验飞书连接" disabled={busy || loading} onPress={() => void load()} /></>}
      {receiptSupported === false && <Text style={styles.subtitle}>飞书服务需要升级发布回执协议，暂不能新发布或重试交付；原草稿与未确认请求保留。</Text>}
      {receipt && <DetailDisclosure key={receipt.operationId} title="预览此次发布正文"><MeetingMarkdown content={visibleNote.content} /></DetailDisclosure>}
      <DetailDisclosure title="发布详情">
      <Text style={styles.subtitle}>此次发布固定正文{publishRevision !== undefined && publishRevision !== '' ? ` · 保存修订 ${publishRevision}` : ' · 本机已保存正文快照'}。本次发布绑定这份正文。</Text>
      {!!receipt && <Text style={styles.subtitle}>保留原发布选择，不会自动换成新内容；请核对这份固定正文。</Text>}
      {frozen && <Text style={styles.subtitle}>本次正文、位置、权限和收件人已冻结。{receipt?.state === 'unknown' ? '提交结果未确认，只查询原操作；关闭或重开不会重新发布。' : '原交付按已确认任务查询。'}</Text>}
      <Text style={styles.subtitle}>{selectedOptions.permission_policy === 'inherit' || selectedOptions.destination_config?.kind === 'folder' || selectedOptions.destination_config?.kind === 'wiki' ? '文档访问沿用目标位置权限。' : '关闭链接及组织外分享；组织内部访问遵循飞书策略。'}群可见或群成员身份不代表可读文档；文档阅读权限与通知送达按实际发布结果分别核验。当前服务按发布修订另建文档。</Text>
      {(receipt || job) && <Text style={styles.subtitle}>{feishuFormattingMessage(
        ready && !loading && !retryPending && receipt?.state === 'acknowledged' && receipt.jobId === job?.id && !deliveryUncertain ? job?.formatting : undefined,
        job?.status,
      )}</Text>}
      </DetailDisclosure>
      {ready && !frozen && !retryPending && !['queued', 'processing'].includes(job?.status || '') && <>
        <DetailDisclosure title="更改位置"><FeishuDestinationPicker showCheck={false} value={options.destination_config || { kind: 'personal' }} disabled={selectionDisabled} onChange={destination_config => { setOptions(current => ({ ...current, destination_config, permission_policy: destination_config.kind === 'personal' ? 'private' : 'inherit' })); invalidateReview() }} /></DetailDisclosure>
        <DetailDisclosure title={`通知 · ${notificationSummary}`}>
        <SettingsCheckbox label="通知本人" checked={!!options.notify_self} disabled={selectionDisabled} onChange={() => { setOptions(current => ({ ...current, notify_self: !current.notify_self })); invalidateReview() }} />
        <Text style={styles.noteTitle}>本次通知群</Text>
        <PrimaryButton secondary title={groupError ? '重试读取本次通知群' : '读取本次可选群'} loading={groupsLoading} disabled={selectionDisabled || groupsLoading} onPress={() => void loadGroups()} />
        {!!groupError && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{groupError}</Text>}
        {groupsLoaded && !groupsLoading && !groupError && !groups.length && <Text style={styles.subtitle}>没有本人和机器人均可见的通知群。</Text>}
        {groups.map(group => <SettingsCheckbox key={group.chat_id} label={`通知群：${group.name}`} checked={!!options.groups?.includes(group.chat_id)} disabled={selectionDisabled || (!options.groups?.includes(group.chat_id) && (options.groups?.length || 0) >= 20)} onChange={selected => {
          if (selectionDisabled) return
          setOptions(current => ({ ...current, groups: selected ? Array.from(new Set([...(current.groups || []), group.chat_id])) : (current.groups || []).filter(id => id !== group.chat_id) })); invalidateReview()
        }} />)}
        {(options.groups || []).filter(id => !groups.some(group => group.chat_id === id)).map((id, index) => <PrimaryButton key={id} secondary title={`移除本次群：${objectReview?.groups.find(group => group.chat_id === id)?.name || `已选群 ${index + 1}（名称未核验）`}`} disabled={selectionDisabled} onPress={() => { if (selectionDisabled) return; setOptions(current => ({ ...current, groups: (current.groups || []).filter(value => value !== id) })); invalidateReview() }} />)}
        <Text style={styles.noteTitle}>本次联系人</Text>
        <TextInput accessibilityLabel="搜索联系人" placeholder="输入联系人姓名" maxLength={50} value={contactQuery} editable={!selectionDisabled && !!contactSupported} style={styles.input} onChangeText={value => {
          contactSequence.current++; setContactQuery(value); setContactItems([]); setContactLoaded(false); setContactPage(''); setContactHasMore(false); setContactError(''); setContactLoading(false)
        }} onSubmitEditing={() => void searchContacts()} />
        <Text style={styles.subtitle}>{verificationUnavailable ? '联系人能力暂时无法核验。' : contactProtocol === null ? '联系人能力尚未核验。' : !contactProtocol ? '飞书服务尚未支持联系人选择，暂不可选；本人和群路径仍可使用。' : !contactSupported ? '当前账号尚未授予联系人搜索权限，暂不可选。' : '所选联系人/群获得阅读权限并收到链接，不授予编辑权限；通知失败文档/已授权保留。'}</Text>
        <PrimaryButton secondary title="搜索联系人" loading={contactLoading} disabled={selectionDisabled || !contactSupported || !contactQuery.trim()} onPress={() => void searchContacts()} />
        {!!contactError && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{contactError}</Text><PrimaryButton secondary title="重试联系人读取" disabled={selectionDisabled || !contactSupported || contactLoading} onPress={() => void searchContacts(contactAttempt.current)} /></>}
        {contactLoaded && !contactLoading && !contactError && !contactItems.length && !contactHasMore && <Text style={styles.subtitle}>没有匹配的联系人。</Text>}
        {contactItems.map(contact => <SettingsCheckbox key={contact.open_id} label={contact.name || '姓名未核验'} checked={!!options.contacts?.some(item => item.open_id === contact.open_id)} disabled={selectionDisabled || !contactSupported || (!options.contacts?.some(item => item.open_id === contact.open_id) && (options.contacts?.length || 0) >= 20)} onChange={selected => selectContact(contact, selected)} />)}
        {contactHasMore && <PrimaryButton secondary title="读取下一页联系人" disabled={selectionDisabled || !contactSupported || contactLoading} onPress={() => void searchContacts({ query: contactAttempt.current.query, page: contactPage, append: true })} />}
        {(options.contacts || []).map(contact => <PrimaryButton key={contact.open_id} secondary title={`移除联系人：${contact.name || '姓名未核验'}`} disabled={selectionDisabled} onPress={() => selectContact(contact, false)} />)}
        </DetailDisclosure>
        {reviewBusy && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>正在读取位置与通知对象…</Text>}
      </>}
      {frozen && <Text style={styles.subtitle}>通知 · {notificationSummary}</Text>}
      {!!reviewError && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{reviewError}</Text><PrimaryButton secondary title="重试读取位置与通知对象" disabled={busy || loading || reviewBusy || frozen || pluginReady !== true} onPress={() => void verifyObjects()} /></>}
      <Text accessibilityLiveRegion="polite" style={styles.subtitle}>
        {retryPending ? '重试结果待核验，只查询原任务；不会再次提交。' : receipt?.state === 'unknown' ? '提交结果待核验，只查询原操作；不会重新发布。' : deliveryUncertain ? '交付结果待核验，请先查询原任务。' : !ready ? loading ? '正在读取交付状态…' : '交付状态读取失败，请重新加载' : job
          ? {
              queued: '等待交付',
              processing: '正在创建文档与发送通知…',
              completed: '已完成',
              failed: '交付需处理',
            }[job.status]
          : '尚未交付到飞书'}
      </Text>
      {(retryPending || receipt?.state === 'unknown' || deliveryUncertain) && <PrimaryButton secondary title={retryPending ? '查询原重试任务' : receipt?.state === 'unknown' ? '查询原发布操作' : '查询原发布任务'} loading={loading} disabled={busy || loading} onPress={() => void load()} />}
      {permissionUncertain && <><Text style={styles.subtitle}>阅读权限结果尚未确认。只读取原文档已有授权，不重新授权或发送通知。{connectionStatus?.recipient_access_protocol !== 1 ? '飞书服务需要升级阅读权限核验协议。' : ''}</Text><PrimaryButton secondary title="核验阅读权限" disabled={busy || loading || !ready || !!retryPending || connectionStatus?.recipient_access_protocol !== 1} onPress={async () => {
        if (!job || busy || loading || !ready || retryPending || connectionStatus?.recipient_access_protocol !== 1) return
        const epoch = identityEpoch(), sequence = ++requestSequence.current, id = job.id
        setBusy(true); setError('')
        try {
          const owner = await readAccountId()
          if (!owner || epoch !== identityEpoch() || sequence !== requestSequence.current || receiptRef.current && receiptRef.current.owner !== owner) throw new Error('账号或原发布已变化')
          const result = await verifyDeliveryPermissions(id, owner)
          const currentOwner = await readAccountId()
          if (epoch !== identityEpoch() || sequence !== requestSequence.current || currentOwner !== owner) return
          if (result.id !== id) throw new Error('返回回执不属于原发布任务')
          setJob(result)
        } catch (cause) { if (epoch === identityEpoch() && sequence === requestSequence.current) setError((cause as Error).message) }
        finally { if (epoch === identityEpoch() && sequence === requestSequence.current) setBusy(false) }
      }} /></>}
      {!!job?.phase && <Text style={styles.subtitle}>发布阶段：{({ awaiting_authorization: '等待授权', pending_create: '等待创建', creating: '正在创建', writing: '写入正文', setting_permissions: '核验权限', notifying: '通知接收人', partial_success: '文档已保留，部分通知失败', permission_unknown: '阅读权限结果未知，先核对', completed: '完成', failed: '需处理', unknown: '结果未知，先核对' } as Record<string, string>)[job.phase] || '阶段尚未核验'}</Text>}
      {!!job && <Text style={styles.subtitle}>文档：{job.document_url ? '已创建，可打开核验' : job.needs_document_recovery ? '创建结果未知' : '尚未确认创建'}</Text>}
      {!!job?.permission && <Text style={styles.subtitle}>权限：{permissionLabels[job.permission.status] || '权限状态尚未核验'} {job.permission.error || ''} {job.permission.note || ''}</Text>}
      {job?.document_url && !completedDocument ? (
        <PrimaryButton
          secondary
          title="查看飞书文档"
          onPress={() =>
            void Linking.openURL(job.document_url).catch(cause =>
              setError(cause.message),
            )
          }
        />
      ) : null}
      {job
        ? Object.entries(job.recipients).map(([id, recipient]) => (
            <Text key={id} style={styles.subtitle}>
              {recipient.name} ·{' '}
              {recipientLabels[recipient.status] || '通知状态尚未核验'}{recipient.error ? ` · ${recipient.error}` : ''}
              {recipient.kind === 'contact' ? ` · 文档读取权限：${recipient.reading_permission?.status === 'verified' ? '已核验已有直接协作者角色，实际阅读未确认' : '尚未核验'}。${recipient.reading_permission?.note || ''}` : ''}
            </Text>
          ))
        : null}
      {error || job?.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error || job?.error}
        </Text>
      ) : null}
      {error ? (
        <PrimaryButton
          secondary
          title="重新加载交付状态"
          disabled={busy || loading}
          onPress={() => void load()}
        />
      ) : null}
      {job?.needs_document_recovery ? (
        <>
          <TextInput
            accessibilityLabel="待关联的飞书文档链接"
            placeholder="本次会议同名空白文档链接"
            value={recoveryUrl}
            onChangeText={setRecoveryUrl}
            style={styles.input}
            editable={!busy && !loading}
          />
          <PrimaryButton
            title="关联已创建文档"
            loading={busy}
            disabled={busy || loading || !!retryPending || !receiptSupported || !ready || !recoveryUrl.trim()}
            onPress={async () => {
              if (retryPending || busy || loading) return
              const sequence = ++requestSequence.current
              setBusy(true)
              try {
                const owner = receiptRef.current?.owner ?? await readAccountId()
                if (!owner) throw new Error('请重新登录')
                const status = await feishuApi<FeishuStatus>('/status', {}, owner)
                if (sequence !== requestSequence.current) return
                if (status.publish_receipt_protocol !== 1) throw new Error('飞书服务需要升级发布回执协议；原交付保留')
                const next = await recoverDeliveryDocument(job.id, recoveryUrl.trim(), owner)
                if (sequence !== requestSequence.current) return
                setJob(next)
                setError('')
              } catch (cause) {
                if (sequence === requestSequence.current) setError((cause as Error).message)
              } finally {
                if (sequence === requestSequence.current) setBusy(false)
              }
            }}
          />
        </>
      ) : null}
      {job?.status === 'failed' ? (
        <PrimaryButton
          title={job.recipient_access_policy === 'grant_view_and_notify' && Object.values(job.recipients).some(recipient => recipient.status === 'pending' && recipient.reading_permission?.status === 'verified') ? '继续通知' : '重试失败步骤'}
          loading={busy}
          disabled={verificationUnavailable || busy || loading || !!retryPending || !receiptSupported || receipt?.state === 'unknown' || job.needs_document_recovery || deliveryUncertain}
          onPress={() => void action(true)}
        />
      ) : null}
      <BottomActionSheetFooter><View style={{ padding: 16, gap: 8 }}><Text style={styles.subtitle}>{completedDocument ? '已发布，可打开文档查看。' : selectedOptions.recipient_access_policy ? '确认授予所选对象阅读权限并发送链接，不授予编辑权限。' : '点击即确认以上正文、位置与通知对象。'}</Text>{completedDocument ? <PrimaryButton title="打开飞书文档" onPress={() => void openCompletedDocument()} /> : <PrimaryButton
        title={selectedOptions.notify_self || selectedOptions.groups?.length || selectedOptions.contacts?.length ? '创建并通知' : '创建文档'}
        loading={busy}
        disabled={
          verificationUnavailable || pluginReady !== true || busy || loading || !!retryPending || reviewBusy || !receiptSupported || !ready || frozen || !objectsVerified || (!!options.contacts?.length && !contactSupported) || deliveryUncertain || !!job?.needs_document_recovery ||
          !note.content.trim() ||
          (!!job && ['queued', 'processing'].includes(job.status))
        }
        onPress={() => void action()}
      />}</View></BottomActionSheetFooter>
      {receipt?.state === 'acknowledged' && job?.status === 'completed' && <PrimaryButton secondary title="准备发布当前已保存版本" disabled={busy || loading || !!retryPending} onPress={async () => { if (retryPending || busy || loading) return; try { const owner = await readAccountId(); if (!owner || owner !== receipt.owner) throw new Error('账号已切换'); const next = newPublishDraft(owner, note.workspace_key || note.id, { title: note.title, content: note.content, versionId: note.workspace_version_id, revisionId: note.workspace_revision === undefined ? undefined : String(note.workspace_revision) }, options); await persistPublishDraft(next); remember(next); setOptions(next.options); invalidateReview() } catch (cause) { setError((cause as Error).message) } }} />}
      {job && Object.entries(job.recipients).filter(([, recipient]) => recipient.status === 'failed').map(([id, recipient]) => <PrimaryButton key={id} secondary title={`仅重试 ${recipient.name}`} disabled={verificationUnavailable || busy || loading || !!retryPending || !receiptSupported || receipt?.state === 'unknown' || deliveryUncertain} onPress={() => void action(true, [id])} />)}
      {onSettings ? (
        <PrimaryButton secondary title="管理飞书设置" disabled={busy || reviewBusy || loading} onPress={async () => {
        if (!onSettings || busy || loading) return
        const epoch = identityEpoch(), request = requestSequence.current
        setBusy(true)
        try {
          const owner = await readAccountId()
          if (!owner || epoch !== identityEpoch() || request !== requestSequence.current) return
          if (!ready) { onSettings(); return }
          const saved = receiptRef.current || newPublishDraft(owner, note.workspace_key || note.id, { title: note.title, content: note.content }, options)
          // Settings may change connection/grants. Never reuse an unsubmitted review.
          const next = saved.state === 'draft' ? { ...saved, options, review: undefined } : saved
          await persistPublishDraft(next)
          if (epoch !== identityEpoch() || request !== requestSequence.current) return
          remember(next)
          onSettings(deliverySettingsReturn(note.id, next))
        } catch (cause) { if (request === requestSequence.current) setError((cause as Error).message) }
        finally { if (request === requestSequence.current) setBusy(false) }
      }} />
      ) : null}
    </View>
  )
}
