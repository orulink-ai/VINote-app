import React, { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from './AppText'
import { Field } from './Field'
import { PrimaryButton } from './PrimaryButton'
import { AsyncState } from './AsyncState'
import { colors, styles } from '../design-system/theme'
import { readAccountId } from '../lib/storage'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { feishuApi, type FeishuDestination } from '../lib/feishu'

type DestinationItem = FeishuDestination & { name: string; has_child?: boolean }
export function FeishuDestinationPicker({ value, onChange, disabled, onChecked, showCheck = true }: { value: FeishuDestination; onChange: (value: FeishuDestination) => void; disabled?: boolean; onChecked?: (allowed: boolean) => void; showCheck?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [verified, setVerified] = useState('')
  const [items, setItems] = useState<DestinationItem[]>([]), [cursor, setCursor] = useState(''), [browseTarget, setBrowseTarget] = useState<FeishuDestination | null>(null)
  const [history, setHistory] = useState<FeishuDestination[]>([])
  const [browseFailure, setBrowseFailure] = useState<{ target: FeishuDestination; pageToken: string; remember: boolean } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const signature = JSON.stringify(value), renderedEpoch = identityEpoch()
  const sequence = useRef(0), working = useRef(false), mounted = useRef(true)
  const checkedRef = useRef(onChecked); checkedRef.current = onChecked
  const valueRef = useRef(signature); valueRef.current = signature
  const disabledRef = useRef(disabled); disabledRef.current = disabled
  const invalidate = () => {
    sequence.current++; working.current = false; setBusy(false); setVerified(''); setError('')
    checkedRef.current?.(false)
  }
  useEffect(() => { invalidate() }, [signature])
  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeIdentity(() => {
      invalidate(); setItems([]); setCursor(''); setHistory([]); setBrowseTarget(null); setBrowseFailure(null); setLoaded(false)
    })
    return () => { mounted.current = false; sequence.current++; working.current = false; unsubscribe() }
  }, [])
  const change = (next: FeishuDestination) => {
    if (!mounted.current || renderedEpoch !== identityEpoch() || signature !== valueRef.current || disabledRef.current || working.current) return
    invalidate(); onChange(next)
  }
  const begin = () => {
    if (!mounted.current || renderedEpoch !== identityEpoch() || signature !== valueRef.current || disabledRef.current || working.current) return null
    const request = ++sequence.current, epoch = identityEpoch(), selected = valueRef.current
    working.current = true; setBusy(true); setError(''); setVerified(''); checkedRef.current?.(false)
    const current = () => mounted.current && request === sequence.current && epoch === identityEpoch() && selected === valueRef.current
    const owner = async () => {
      const account = await readAccountId()
      if (!current() || !account) throw new Error('原位置核验已停止，请重新核验当前账号的位置')
      return account
    }
    const guard = async (account: string) => {
      if (!current() || await readAccountId() !== account || !current()) throw new Error('账号或位置已变化，原核验结果不可使用')
    }
    const finish = () => { if (current()) { working.current = false; setBusy(false) } }
    const fail = (cause: unknown) => { if (current()) { checkedRef.current?.(false); setError(cause instanceof Error ? cause.message : '位置读取失败') } }
    return { owner, guard, current, finish, fail }
  }
  const browse = async (target: FeishuDestination, pageToken = '', remember = true) => {
    const request = begin()
    if (!request) return false
    setBrowseFailure(null)
    try {
      const owner = await request.owner()
      const query = new URLSearchParams({ kind: target.kind === 'wiki' ? 'wiki' : 'folder', folder_token: target.folder_token || '', space_id: target.space_id || '', parent_node_token: target.node_token || '', page_token: pageToken })
      const result = await feishuApi<{ items: DestinationItem[]; has_more: boolean; page_token: string }>(`/destinations?${query}`, {}, owner)
      await request.guard(owner)
      if (!pageToken && remember && browseTarget && JSON.stringify(target) !== JSON.stringify(browseTarget)) setHistory(previous => [...previous, browseTarget])
      setLoaded(true)
      setItems(current => pageToken ? [...current, ...result.items] : result.items); setCursor(result.has_more ? result.page_token : ''); setBrowseTarget(target)
      return true
    } catch (cause) {
      if (request.current()) setBrowseFailure({ target, pageToken, remember })
      request.fail(cause); return false
    } finally { request.finish() }
  }
  const check = async () => {
    const request = begin()
    if (!request) return
    const selected = { ...value }
    try {
      const owner = await request.owner()
      const result = await feishuApi<{ name?: string; path?: string[]; path_complete: boolean; reason?: string; can_create: boolean; can_attempt_create?: boolean; permission_state: string }>('/destinations/check', { method: 'POST', body: JSON.stringify(selected) }, owner)
      await request.guard(owner)
      checkedRef.current?.(result.can_attempt_create === true)
      setVerified(`${result.path_complete ? '位置' : '已核验路径片段'}：${result.path?.join(' / ') || result.name || '目标位置'} · ${result.can_create === true ? '已核验创建权限' : result.can_attempt_create === true ? '目录可读，创建权限将在提交时核验' : '当前不可创建'}${result.reason ? `：${result.reason}` : ''}`)
    } catch (cause) { request.fail(cause) } finally { request.finish() }
  }
  return <View style={{ gap: 10 }}>
    <Text style={styles.label}>文档位置</Text>
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{([{ kind: 'personal', label: '个人云文档' }, { kind: 'folder', label: '共享目录' }, { kind: 'wiki', label: '知识库' }] as const).map(item => <Pressable key={item.kind} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: value.kind === item.kind, disabled: !!disabled || busy }} disabled={disabled || busy} onPress={() => { if (value.kind !== item.kind) { setItems([]); setCursor(''); setBrowseTarget(null); setHistory([]); setBrowseFailure(null); setLoaded(false); change({ kind: item.kind }) } }} style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: value.kind === item.kind ? colors.ink : colors.line, backgroundColor: value.kind === item.kind ? colors.primarySoft : colors.card }}><Text style={styles.subtitle}>{item.label}</Text></Pressable>)}</View>
    {value.kind === 'folder' && <Field label="文件夹 token" value={value.folder_token || ''} onChangeText={folder_token => change({ kind: 'folder', folder_token })} editable={!disabled && !busy} />}
    {value.kind === 'wiki' && <><Field label="知识空间 ID" value={value.space_id || ''} onChangeText={space_id => change({ ...value, space_id })} editable={!disabled && !busy} /><Field label="父节点 token" value={value.node_token || ''} onChangeText={node_token => change({ ...value, node_token })} editable={!disabled && !busy} /></>}
    {value.kind !== 'personal' && <PrimaryButton secondary title={value.kind === 'wiki' ? '浏览知识空间' : '浏览可见文件夹'} loading={busy} disabled={disabled || busy} onPress={() => void browse({ kind: value.kind })} />}
    {history.length > 0 && <PrimaryButton tertiary title="返回上一级位置" disabled={disabled || busy} onPress={async () => { const epoch = identityEpoch(), selected = valueRef.current; if (await browse(history[history.length - 1], '', false) && mounted.current && epoch === identityEpoch() && selected === valueRef.current) setHistory(previous => previous.slice(0, -1)) }} />}
    {loaded && !items.length && !error && <Text style={styles.subtitle}>{cursor ? '当前页没有可见位置，请继续读取下一页。' : '此处没有可见位置，可返回上级或填写已知标识。'}</Text>}
    {items.map(item => <View key={`${item.kind}:${item.folder_token || item.space_id}:${item.node_token || ''}`} style={styles.listRow}><Text style={styles.noteTitle}>{item.name}</Text>{(item.kind === 'folder' || !!item.node_token) && <PrimaryButton secondary title="选择此位置" disabled={disabled || busy} onPress={() => change(item.kind === 'folder' ? { kind: 'folder', folder_token: item.folder_token } : { kind: 'wiki', space_id: item.space_id, node_token: item.node_token })} />}{item.kind === 'folder' || item.has_child ? <PrimaryButton tertiary title="进入子目录" disabled={busy || disabled} onPress={() => void browse(item)} /> : null}</View>)}
    {!!cursor && browseTarget && <PrimaryButton secondary title="继续读取下一页" disabled={busy || disabled} onPress={() => void browse(browseTarget, cursor)} />}
    <Text style={styles.subtitle}>{value.kind === 'personal' ? '关闭链接及组织外分享；组织内部访问遵循飞书策略，通知接收人的阅读权限另行核验。' : '沿用目标位置权限。可见目录不代表能写入，请先核验；写入结果以实际发布为准。'}</Text>
    {showCheck && <PrimaryButton secondary title="核验位置与权限" disabled={disabled || busy} loading={busy} onPress={() => void check()} />}
    {!!verified && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{verified}</Text>}<AsyncState error={error} retryLabel="重新读取此位置" onRetry={browseFailure ? () => void browse(browseFailure.target, browseFailure.pageToken, browseFailure.remember) : undefined} />
  </View>
}
