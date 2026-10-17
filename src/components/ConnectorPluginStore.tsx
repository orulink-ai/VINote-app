import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { Text } from './AppText'
import { WorkspaceIcon } from './WorkspaceIcon'
import { colors, styles } from '../design-system/theme'
import { readAccountId } from '../lib/storage'
import { identityEpoch } from '../lib/sessionIdentity'
import { feishuApi, type FeishuStatus } from '../lib/feishu'
import { createConnectorPluginStore, type ConnectorPluginState } from '../lib/connectorPlugins'

const store = createConnectorPluginStore(Storage)
export function ConnectorPluginStore({ epoch, onFeishu, onMcp }: { epoch: number; onFeishu: () => void; onMcp: () => void }) {
  const [tab, setTab] = useState<'explore' | 'installed'>('explore'), [search, setSearch] = useState('')
  const [saved, setSaved] = useState<ConnectorPluginState | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [authorization, setAuthorization] = useState<'loading' | 'connected' | 'none' | 'failed'>('loading')
  const scope = useRef({ active: false, owner: '', locked: false })
  const authorizationEpoch = useRef(0)
  const failedSave = useRef<ConnectorPluginState | null>(null)
  const current = () => scope.current.active && identityEpoch() === epoch
  async function readAuthorization(owner: string) {
    if (!current()) return
    const requestEpoch = ++authorizationEpoch.current
    setAuthorization('loading')
    try { const status = await feishuApi<FeishuStatus>('/status', {}, owner); if (current() && requestEpoch === authorizationEpoch.current) setAuthorization(status.connected ? 'connected' : 'none') }
    catch { if (current() && requestEpoch === authorizationEpoch.current) setAuthorization('failed') }
  }
  async function read() {
    if (!current() || scope.current.locked) return
    scope.current.locked = true; setBusy(true); setError('')
    try {
      const owner = await readAccountId()
      if (!current()) return
      if (!owner) throw new Error('请先登录，再读取此账号的安装设置。')
      scope.current.owner = owner
      const next = await store.read(owner, current)
      if (current()) { setSaved(next); void readAuthorization(owner) }
    } catch (cause) { if (current()) setError((cause as Error).message) }
    finally { if (current()) { scope.current.locked = false; setBusy(false) } }
  }
  async function save(next: ConnectorPluginState) {
    if (!current() || !saved || scope.current.locked) return
    scope.current.locked = true; failedSave.current = next; setBusy(true); setError('')
    try {
      if (await readAccountId() !== scope.current.owner) throw new Error('账号已切换')
      const value = await store.save(scope.current.owner, next, current)
      if (current()) { setSaved(value); failedSave.current = null }
    } catch { if (current()) setError('安装设置未能保存，原状态保留。请重试。') }
    finally { if (current()) { scope.current.locked = false; setBusy(false) } }
  }
  useEffect(() => { scope.current.active = true; void read(); return () => { scope.current.active = false } }, [])
  const action = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [primary ? styles.button : styles.secondaryButton, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}><Text style={primary ? styles.buttonText : styles.secondaryButtonText}>{label}</Text></Pressable>
  const matches = '飞书 feishu 文档 发布 通知'.includes(search.trim().toLowerCase())
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.subtitle}>探索内置插件，管理已安装的能力与工具连接。</Text>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>{(['explore', 'installed'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.secondaryButton, { flex: 1, backgroundColor: tab === value ? colors.primarySoft : colors.card }]}><Text style={styles.secondaryButtonText}>{value === 'explore' ? '探索' : '已安装'}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="搜索插件" placeholder="搜索名称或能力" placeholderTextColor={colors.muted} style={styles.input} value={search} onChangeText={setSearch} />
    {error !== '' && <View style={styles.card}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>{action('重试', () => void (failedSave.current ? save(failedSave.current) : read()), busy)}</View>}
    {!saved && !error && <View style={{ gap: 8 }}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={styles.subtitle}>正在读取安装状态…</Text></View>}
    {saved && (matches && (tab === 'explore' || saved.installed) ? <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><WorkspaceIcon name="content" color={colors.navigationAccent} /><View style={{ flex: 1 }}><Text style={styles.noteTitle}>飞书</Text><Text style={styles.subtitle}>内置连接</Text></View><Text accessibilityLiveRegion="polite" style={styles.subtitle}>{saved.installed ? saved.enabled ? '已启用' : '已停用' : '未安装'}</Text></View>
      <Text style={styles.noteBody}>将选定的会议纪要或笔记发布为飞书文档，管理阅读权限与消息通知。</Text>
      <Text style={styles.subtitle}>安装后，从纪要或笔记详情发布飞书文档。停用不会撤销授权或删除已发布的文档。</Text>
      {saved.installed ? <>{action(busy ? '正在保存…' : saved.enabled ? '停用' : '启用', () => void save({ installed: true, enabled: !saved.enabled }), busy)}{action('管理', onFeishu)}</> : <>{action(busy ? '正在保存…' : '安装', () => void save({ installed: true, enabled: true }), busy, true)}{action('管理授权', onFeishu)}</>}
      {authorization === 'connected' && !saved.installed && <Text style={styles.subtitle}>已有飞书授权，可直接管理；商店模块尚未安装。</Text>}
      {authorization === 'loading' && <Text style={styles.subtitle}>正在核验已有授权…</Text>}
      {authorization === 'failed' && <><Text accessibilityRole="alert" style={styles.subtitle}>已有授权暂时无法核验，可进入管理查看。</Text>{action('重试核验授权', () => void readAuthorization(scope.current.owner))}</>}
    </View> : <View style={styles.emptyState}><Text style={styles.noteTitle}>{search ? '没有匹配的插件' : '尚未安装插件'}</Text><Text style={styles.subtitle}>到探索中安装飞书内置模块。</Text>{action('返回探索', () => { setSearch(''); setTab('explore') })}</View>)}
    <View style={styles.card}><Text style={styles.noteTitle}>工具连接管理</Text><Text style={styles.subtitle}>MCP 工具分别管理服务连接与授权。全文翻译从内容详情进入，执行前预览确认。</Text>{action('管理 MCP 工具', onMcp)}</View>
  </ScrollView>
}
