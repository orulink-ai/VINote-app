import React, { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Switch, TextInput, View } from 'react-native'
import { Text } from '../components/AppText'
import { Field } from '../components/Field'
import { PrimaryButton } from '../components/PrimaryButton'
import { ScreenHeader } from '../components/ScreenHeader'
import { BottomActionSheet } from '../components/BottomActionSheet'
import { AsyncState } from '../components/AsyncState'
import { colors, styles } from '../design-system/theme'
import { mcpApi, runLabels, type MCPConnection, type MCPTool, type MCPRun } from '../lib/mcp'
import { operationId } from '../lib/integration'
import { readAccountId } from '../lib/storage'
import { editNoteContent, getNote } from '../lib/notes'
import { MeetingMarkdown } from '../components/MeetingMarkdown'
import { clearMCPIntent, recoverMCPIntent, persistMCPIntent, translationFields, translationArguments, mcpTextResult, type MCPIntent } from '../lib/mcpTranslation'
import type { Note } from '../types/api'
import { markdownPreview } from '../lib/markdown'

type TranslationModelOptions = { models: Array<{ id: string; modelType: string; runtimeStatus: string }>; defaultModel: string | null }

export function MCPScreen({ onBack, note }: { onBack: () => void; note?: Note }) {
  const [connections, setConnections] = useState<MCPConnection[]>([]), [runs, setRuns] = useState<MCPRun[]>([])
  const [selected, setSelected] = useState<MCPConnection | null>(null), [tools, setTools] = useState<MCPTool[]>([])
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [token, setToken] = useState('')
  const [editing, setEditing] = useState<MCPConnection | null>(null), [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [tool, setTool] = useState<MCPTool | null>(null), [argumentsText, setArgumentsText] = useState('{}')
  const [pending, setPending] = useState<MCPIntent | null>(null)
  const [translation, setTranslation] = useState(false), [textField, setTextField] = useState(''), [languageField, setLanguageField] = useState(''), [language, setLanguage] = useState('en')
  const [savedResult, setSavedResult] = useState(false), [compareSource, setCompareSource] = useState(false)
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false)
  const [managementOpen, setManagementOpen] = useState(false), [toolsLoaded, setToolsLoaded] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([]), [translationModel, setTranslationModel] = useState('')
  const owner = useRef('')
  const mounted = useRef(true), epoch = useRef(0), confirmedRequest = useRef<string | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1 } }, [])
  const managedTranslation = selected?.managed && selected.providerId === 'vinote-cloud-translation'
  const lock = useRef(false)
  const action = async (fn: () => Promise<unknown>) => {
    if (lock.current) return
    const startedEpoch = epoch.current, startedOwner = owner.current
    lock.current = true; setBusy(true); setError('')
    try { await fn() } catch (cause) { if (mounted.current && epoch.current === startedEpoch && (!startedOwner || await readAccountId() === startedOwner)) setError((cause as Error).message) }
    finally { lock.current = false; if (mounted.current && epoch.current === startedEpoch) setBusy(false) }
  }
  const refresh = async () => {
    const result = await mcpApi<{ connections: MCPConnection[] }>('')
    setConnections(result.connections); setLoaded(true)
    const history = await mcpApi<{ runs: MCPRun[] }>('/runs?limit=50&offset=0')
    setRuns(history.runs)
    if (pending) {
      const run = await mcpApi<MCPRun>(`/runs/by-request/${encodeURIComponent(pending.requestId)}`, {}, owner.current)
      if (run) { setPending({ ...pending, run }); await persistMCPIntent(owner.current, { ...pending, run: { ...run, result: null } }) }
    }
    return result.connections
  }
  const readTranslationModels = async (savedChoice?: string) => {
    const result = await mcpApi<TranslationModelOptions>('/first-party/translation/models', {}, owner.current)
    const available = result.models.filter(row => row.modelType === 'llm' && row.runtimeStatus === 'available').map(row => row.id)
    setModelOptions(available)
    setTranslationModel(current => available.includes(current) ? current : savedChoice && available.includes(savedChoice) ? savedChoice : result.defaultModel && available.includes(result.defaultModel) ? result.defaultModel : '')
  }
  useEffect(() => { void action(async () => {
    owner.current = await readAccountId() || ''; if (!owner.current) throw new Error('请重新登录')
    const initialConnections = await refresh()
    const restored = await recoverMCPIntent(owner.current)
    if (restored) {
      setPending(restored); setSavedResult(!!restored.locallySaved)
      const list = await mcpApi<{ connections: MCPConnection[] }>('')
      const connection = list.connections.find(row => row.id === restored.connectionId)
      if (connection) { setSelected(connection); const found = await mcpApi<{ tools: MCPTool[] }>(`/${connection.id}/tools`); setTools(found.tools); setToolsLoaded(true); setTool(null); if (connection.providerId === 'vinote-cloud-translation') await readTranslationModels(typeof restored.arguments.model === 'string' ? restored.arguments.model : undefined) }
      setTranslation(!!restored.source)
    } else if (note) {
      const connection = initialConnections.find(row => row.managed && row.providerId === 'vinote-cloud-translation')
      if (connection) await open(connection)
    }
  }) }, [])
  const open = async (connection: MCPConnection) => {
    if (pending && (!pending.run || ['running', 'unknown', 'awaiting_confirmation'].includes(pending.run.status))) throw new Error('请先核验或取消原调用；返回不会清除原请求')
    setSelected(connection); setTools([]); setToolsLoaded(false); setTool(null)
    const result = await mcpApi<{ tools: MCPTool[] }>(`/${connection.id}/tools`)
    setTools(result.tools); setToolsLoaded(true)
    if (connection.providerId === 'vinote-cloud-translation') await readTranslationModels()
    return result.tools
  }
  const connectTranslation = async () => {
    if (pending && (!pending.run || ['running', 'unknown', 'awaiting_confirmation'].includes(pending.run.status))) throw new Error('先核验原调用，再选择新的翻译工具')
    try {
      const result = await mcpApi<{ connection: MCPConnection; provider: { configured: boolean } }>('/first-party/translation', { method: 'POST', body: '{}' }, owner.current)
      await refresh()
      setSelected(result.connection); setTools([]); setToolsLoaded(false); setTool(null)
      if (!result.connection.enabled) throw new Error('云翻译连接已停用，请明确启用后再发现工具')
      const found = await mcpApi<{ connection: MCPConnection; tools: MCPTool[] }>(`/${result.connection.id}/discover`, { method: 'POST' }, owner.current)
      setSelected(found.connection); setTools(found.tools); setToolsLoaded(true)
      await readTranslationModels()
      await refresh()
    } catch (cause) {
      const message = (cause as Error).message || ''
      if (/404|405|Not Found|Method Not Allowed/i.test(message)) throw new Error('当前共享服务尚未提供云翻译，请等待服务更新后重新连接。现有笔记保留。')
      throw cause
    }
  }
  const invoke = async (confirmed = false) => {
    if (!selected || !tool) return
    const args: unknown = JSON.parse(argumentsText)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是 JSON 对象')
    const payload: MCPIntent = pending || { requestId: operationId(), toolName: tool.name, arguments: translation ? translationArguments(tool, textField, languageField, language, note!, args, managedTranslation ? translationModel : undefined) : args as Record<string, unknown>, connectionId: selected.id, ...(translation && note ? { source: { ...note } } : {}) }
    // Dispatch uncertainty must only offer status lookup, never another confirm.
    const durable = confirmed && payload.run ? { ...payload, run: { ...payload.run, status: 'unknown' as const, result: null } } : payload
    await persistMCPIntent(owner.current, durable)
    setPending(durable)
    if (confirmed) confirmedRequest.current = payload.requestId
    const run = await mcpApi<MCPRun>(`/${payload.connectionId}/invoke`, { method: 'POST', body: JSON.stringify({ requestId: payload.requestId, toolName: payload.toolName, arguments: payload.arguments,
      ...(confirmed ? { confirmed: true, confirmationToken: payload.run?.confirmationToken } : {}) }) }, owner.current)
    await persistMCPIntent(owner.current, { ...payload, run: { ...run, result: null } })
    setPending({ ...payload, run }); setRuns(current => [run, ...current.filter(item => item.id !== run.id)])
  }
  const official = connections.find(row => row.managed && row.providerId === 'vinote-cloud-translation')
  const officialTool = managedTranslation && toolsLoaded ? tools.find(row => row.name === 'vinote_translate_text') : undefined
  const awaitingReceipt = pending && (!pending.run || ['running', 'unknown', 'awaiting_confirmation'].includes(pending.run.status))
  const supportsModel = !!officialTool && translationFields(officialTool).includes('model')
  const serviceStatus = !loaded ? '正在读取状态' : !official ? '未连接' : !official.enabled ? '已停用' : !toolsLoaded ? '待核验' : !officialTool ? '未发现工具' : !supportsModel ? '工具需更新' : !officialTool.enabled ? '等待授权' : !translationModel ? '请选择模型' : '已就绪'
  const sourceTime = note?.updated_at && Number.isFinite(Date.parse(note.updated_at)) ? new Date(note.updated_at).toLocaleString('zh-CN') : null
  const resultIssue = (pending?.run?.result as { structuredContent?: { error?: { code?: string } } } | null)?.structuredContent?.error?.code
  const failureMessage = resultIssue === 'model_unavailable' ? pending?.arguments.model
    ? '此调用选择的模型当前不可用。原调用与原文保留；请先核对结果，再选择可用模型发起新翻译。'
    : '云翻译暂时没有可用的默认模型，请等待服务配置恢复后再发起翻译。' : pending?.run?.error?.message
  const pendingLabel = pending?.run ? busy && confirmedRequest.current === pending.requestId && pending.run.status === 'unknown' ? '正在等待翻译结果' : runLabels[pending.run.status] : busy ? '准备预览中' : '回执待核验'
  const saveTranslationResult = async () => {
    if (!pending?.source || !pending.run) return
    const originalOwner = owner.current, startedEpoch = epoch.current, source = pending.source, intent = pending
    const guard = async () => { if (!originalOwner || !mounted.current || epoch.current !== startedEpoch || await readAccountId() !== originalOwner) throw new Error('账号或页面已切换，译文保留在原调用中') }
    await guard()
    const value = mcpTextResult(intent.run!)
    if (!value) throw new Error('工具没有返回可保存的文字译文')
    const current = await getNote(source.id)
    await guard()
    if (current.content !== value) await editNoteContent(source.id, value, source, originalOwner)
    await guard()
    const saved = { ...intent, locallySaved: true }
    await persistMCPIntent(originalOwner, { ...saved, run: { ...intent.run!, result: null } })
    await guard(); setPending(saved); setSavedResult(true)
  }
  const startTranslation = async (item: MCPTool) => {
    if (awaitingReceipt) throw new Error('先核验或取消原调用，再开始另一项调用')
    if (managedTranslation && (!translationModel || !modelOptions.includes(translationModel) || !translationFields(item).includes('model'))) throw new Error('请在连接与授权中核验工具，并选择可用模型')
    await clearMCPIntent(owner.current)
    setAuthorizationOpen(false); setTool(item); setArgumentsText('{}'); setPending(null); setTranslation(!!managedTranslation && !!note)
    setTextField(managedTranslation ? 'text' : ''); setLanguageField(managedTranslation ? 'target_language' : '')
    setSavedResult(false); setSourcePreviewOpen(false)
    if (managedTranslation && note && selected) {
      const payload: MCPIntent = { requestId: operationId(), toolName: item.name, arguments: translationArguments(item, 'text', 'target_language', language, note, {}, translationModel), connectionId: selected.id, source: { ...note } }
      await persistMCPIntent(owner.current, payload)
      setPending(payload)
      const run = await mcpApi<MCPRun>(`/${payload.connectionId}/invoke`, { method: 'POST', body: JSON.stringify({ requestId: payload.requestId, toolName: payload.toolName, arguments: payload.arguments }) }, owner.current)
      await persistMCPIntent(owner.current, { ...payload, run: { ...run, result: null } })
      setPending({ ...payload, run }); setRuns(current => [run, ...current.filter(row => row.id !== run.id)])
    }
  }
  return <View style={styles.screen}>
    <ScreenHeader title={note && !managementOpen ? '全文翻译' : 'MCP 工具'} onBack={note && managementOpen ? () => setManagementOpen(false) : onBack} right={(!note || managementOpen) ? <PrimaryButton title="＋ 连接" disabled={busy} style={{ minHeight: 44, paddingVertical: 8 }} onPress={() => { setEditing(null); setName(''); setUrl(''); setToken(''); setFormOpen(true) }} /> : undefined} />
    {note && !managementOpen ? <><ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.card, { gap: 6, padding: 12 }]}><Text style={styles.label}>所选正文</Text><Text style={styles.noteTitle}>{note.title}</Text><Text style={styles.subtitle}>{sourceTime ? `保存于 ${sourceTime}` : '已保存正文 · 保存时间暂不可用'}{note.workspace_revision ? ` · 内容修订 ${note.workspace_revision}` : ''}</Text><Text numberOfLines={2} style={styles.subtitle}>{markdownPreview(note.content)}</Text><PrimaryButton tertiary title={sourcePreviewOpen ? '收起原文' : '阅读完整原文'} onPress={() => setSourcePreviewOpen(!sourcePreviewOpen)} />{sourcePreviewOpen && <MeetingMarkdown content={note.content} />}</View>
      <View style={[styles.card, { gap: 6, padding: 12 }]}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}><Text style={styles.noteTitle}>VINote 云翻译</Text><Text style={styles.subtitle}>{serviceStatus}</Text></View>
        <Text style={styles.subtitle}>仅在你确认时发送所选正文，不发送原始音视频。</Text>
        {!!translationModel && <Text style={styles.subtitle}>模型：{translationModel}</Text>}
        <PrimaryButton tertiary title="连接与授权" disabled={busy} onPress={() => { setTool(null); setAuthorizationOpen(true) }} />
      </View>
      {!!error && <View style={styles.card}><AsyncState error={error} retryLabel="重新读取状态" onRetry={() => void action(refresh)} /></View>}
      <View style={styles.card}><Text style={styles.label}>目标语言</Text><View style={{ flexDirection: 'row', gap: 10 }}>{[['en', '英语'], ['zh', '简体中文']].map(([value, title]) => <PrimaryButton key={value} title={title} secondary={language === value} tertiary={language !== value} disabled={busy || !!awaitingReceipt} onPress={() => setLanguage(value)} />)}</View></View>
      {pending && <View style={styles.card}><Text style={styles.noteTitle}>{pending.run?.status === 'failed' ? '上次翻译尝试' : '本次翻译'} · {pendingLabel}</Text><Text style={styles.subtitle}>来源：{pending.source?.title || '原调用所选内容'}。退出页面不会再次执行。</Text><PrimaryButton secondary title="查看原调用与结果" disabled={busy} onPress={() => void action(async () => { const run = await mcpApi<MCPRun>(`/runs/by-request/${encodeURIComponent(pending.requestId)}`, {}, owner.current); const next = { ...pending, run }; setPending(next); await persistMCPIntent(owner.current, { ...next, run: { ...run, result: null } }); setTool(tools.find(row => row.name === pending.toolName) || { name: pending.toolName, description: '', enabled: false, definitionHash: '', requiresConfirmation: true, inputSchema: {} }) })} /></View>}
    </ScrollView><View style={{ padding: 16, borderTopWidth: 1, borderColor: colors.line }}><PrimaryButton title="预览翻译" disabled={busy || !officialTool?.enabled || !official?.enabled || !supportsModel || !translationModel || !!awaitingReceipt} onPress={() => officialTool && void action(() => startTranslation(officialTool))} /></View></> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>连接远程 HTTPS 服务。仅发送明确填写的参数，每次调用都需确认。工具结果作为资料阅读。</Text>
      <View style={styles.card}><Text style={styles.noteTitle}>VINote 云翻译 · MCP</Text><Text style={styles.subtitle}>将选定正文翻译为中文或英文，预览后另存版本。使用当前 VINote 云会话，无需填写服务地址或密钥；不会自动启用工具或发送正文。</Text><PrimaryButton secondary title="连接云翻译" disabled={busy || !loaded} onPress={() => void action(connectTranslation)} /></View>
      <PrimaryButton tertiary title={catalogOpen ? '收起工具接入说明' : '可连接哪些工具？'} onPress={() => setCatalogOpen(!catalogOpen)} />
        {catalogOpen && <View style={styles.card}><Text style={styles.noteTitle}>接入实际使用的服务</Text><Text style={styles.subtitle}>添加翻译、术语检索或业务系统的 HTTPS MCP 地址，发现工具后逐项启用。调用前选择内容并确认参数；尚未接入的服务不会显示为已安装插件。</Text></View>}
      {note && <Text style={styles.noteTitle}>所选内容：{note.title} · 当前已保存正文（不会自动发送）</Text>}
      <AsyncState loading={busy && !loaded} loadingLabel="正在读取连接与运行记录" retryLabel="重新读取连接" error={error} onRetry={() => void action(refresh)} />
      <PrimaryButton tertiary style={{ alignSelf: 'flex-start' }} title="刷新状态" loading={busy} onPress={() => void action(refresh)} />
      {pending && !tool && <View style={styles.card}><Text style={styles.noteTitle}>原调用 · {pending.run ? runLabels[pending.run.status] : '回执待核验'}</Text><PrimaryButton secondary title="核验原调用并查看结果" disabled={busy} onPress={() => void action(async () => { const run = await mcpApi<MCPRun>(`/runs/by-request/${encodeURIComponent(pending.requestId)}`, {}, owner.current); const value = { ...pending, run }; setPending(value); await persistMCPIntent(owner.current, { ...value, run: { ...run, result: null } }); setTool({ name: pending.toolName, description: '', enabled: false, definitionHash: '', requiresConfirmation: true, inputSchema: {} }) })} /></View>}
      {!connections.length && loaded && <Text style={styles.subtitle}>尚未添加服务。添加后发现工具，再选择允许使用的工具。</Text>}
      {connections.map(connection => <View key={connection.id} style={styles.card}>
        <Text style={styles.noteTitle}>{connection.name} · {connection.enabled ? connection.status === 'connected' ? '已发现工具' : '待连接/核验' : '已禁用'}</Text>
        <Text selectable style={styles.subtitle}>{connection.url}</Text>
        {!!connection.lastError && <Text style={{ color: colors.danger }}>{connection.lastError}</Text>}
        <PrimaryButton secondary title="工具与权限" disabled={busy} onPress={() => void action(() => open(connection))} />
        {connection.managed ? <Text style={styles.subtitle}>第一方连接使用当前云账号，地址固定；授权过期时重新登录 VINote，不在此保存 Token。</Text> : <PrimaryButton tertiary title="编辑地址或重新认证" disabled={busy} onPress={() => { setEditing(connection); setName(connection.name); setUrl(connection.url); setToken(''); setFormOpen(true) }} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={styles.label}>允许新调用</Text><Switch accessibilityLabel={`启用${connection.name}`} value={connection.enabled} disabled={busy} onValueChange={enabled => void action(async () => { await mcpApi(`/${connection.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }); await refresh() })} /></View>
        <PrimaryButton tertiary title="移除连接" disabled={busy} onPress={() => Alert.alert('移除连接？', '停止新调用并移除凭证。已执行的远程操作不会回滚，运行记录保留。', [{ text: '取消' }, { text: '移除', style: 'destructive', onPress: () => void action(async () => { await mcpApi(`/${connection.id}`, { method: 'DELETE' }); if (selected?.id === connection.id) { setSelected(null); setTools([]) }; await refresh() }) }])} />
      </View>)}
      {selected && <View style={{ gap: 12 }}><Text style={styles.noteTitle}>{selected.name} · 工具清单</Text>
        {managedTranslation && !note && <Text style={styles.subtitle}>连接与权限在这里管理。全文翻译请从会议或笔记的“内容操作”进入，以明确选择需要翻译的正文。</Text>}
        <PrimaryButton secondary title="连接并重新发现工具" disabled={busy || !selected.enabled} onPress={() => void action(async () => { const result = await mcpApi<{ connection: MCPConnection; tools: MCPTool[] }>(`/${selected.id}/discover`, { method: 'POST' }); setTools(result.tools); setSelected(result.connection); await refresh() })} />
        {!tools.length && <Text style={styles.subtitle}>尚无已发现工具。连接失败时检查地址与凭证后重新发现。</Text>}
        {tools.map(item => <View key={item.name} style={styles.card}><Text style={styles.noteTitle}>{item.name}</Text><Text style={styles.subtitle}>{item.description}</Text><Text style={styles.subtitle}>每次调用需确认 · 新定义默认禁用</Text>
          <Switch accessibilityLabel={`允许工具${item.name}`} value={item.enabled} disabled={busy} onValueChange={enabled => void action(async () => { const next = await mcpApi<MCPTool>(`/${selected.id}/tools`, { method: 'PATCH', body: JSON.stringify({ name: item.name, enabled }) }); setTools(current => current.map(row => row.name === next.name ? next : row)) })} />
          <PrimaryButton secondary title={managedTranslation ? '全文翻译当前笔记' : '查看参数并调用'} disabled={busy || !item.enabled || !selected.enabled || (!!managedTranslation && !note)} onPress={() => void action(async () => { if (pending && (!pending.run || ['running', 'unknown', 'awaiting_confirmation'].includes(pending.run.status))) throw new Error('先核验或取消原调用，再开始另一项调用'); await clearMCPIntent(owner.current); setTool(item); setArgumentsText('{}'); setPending(null); setTranslation(!!managedTranslation && !!note); setTextField(managedTranslation ? 'text' : ''); setLanguageField(managedTranslation ? 'target_language' : ''); setSavedResult(false) })} /></View>)}
      </View>}
      <Text style={styles.noteTitle}>最近调用</Text>
      {!runs.length && loaded && <Text style={styles.subtitle}>尚无调用记录。</Text>}
      {runs.map(run => <View key={run.id} style={styles.card}><Text style={styles.noteTitle}>{run.toolName} · {runLabels[run.status]}</Text><Text style={styles.subtitle}>{new Date(run.createdAt).toLocaleString('zh-CN')}</Text>{run.error && <Text style={{ color: colors.danger }}>{run.error.message}</Text>}{run.result && <Text selectable style={styles.noteBody}>{JSON.stringify(run.result, null, 2).slice(0, 16000)}</Text>}{run.status === 'awaiting_confirmation' && <PrimaryButton secondary title="取消待确认调用" disabled={busy} onPress={() => void action(async () => { await mcpApi(`/runs/${run.id}/cancel`, { method: 'POST' }); await refresh() })} />}{['running', 'unknown'].includes(run.status) && <Text style={styles.subtitle}>请先核对远程结果；当前服务不支持远程撤销，不会自动重复调用。</Text>}</View>)}
    </ScrollView>}
    <BottomActionSheet visible={authorizationOpen} title="翻译连接与授权" onClose={() => { if (!busy) setAuthorizationOpen(false) }}>
      <Text style={styles.noteTitle}>VINote 云翻译 · {serviceStatus}</Text>
      <Text style={styles.subtitle}>连接使用当前 VINote 账号。连接后还需允许翻译工具；每次发送正文仍由你确认。</Text>
      <View style={{ minHeight: 64 }}><AsyncState error={error} /></View>
      <View style={{ minHeight: 48, justifyContent: 'center' }}>{official ? <Text style={styles.subtitle}>✓ 云翻译已连接</Text> : <PrimaryButton secondary title="连接云翻译" disabled={busy || !loaded || !!awaitingReceipt} onPress={() => void action(connectTranslation)} />}</View>
      <View style={{ minHeight: 48, justifyContent: 'center' }}>{toolsLoaded && officialTool ? <Text style={styles.subtitle}>✓ 工具已核验</Text> : <PrimaryButton tertiary title="读取翻译工具" disabled={busy || !official || !official.enabled || !!awaitingReceipt} onPress={() => void action(async () => { if (!official) return; const known = await open(official); if (!known.length) { const found = await mcpApi<{ connection: MCPConnection; tools: MCPTool[] }>(`/${official.id}/discover`, { method: 'POST' }, owner.current); setSelected(found.connection); setTools(found.tools); setToolsLoaded(true) } })} />}</View>
      {toolsLoaded && !supportsModel && official && <PrimaryButton secondary title="更新翻译工具定义" disabled={busy || !official.enabled || !!awaitingReceipt} onPress={() => void action(async () => { const found = await mcpApi<{ connection: MCPConnection; tools: MCPTool[] }>(`/${official.id}/discover`, { method: 'POST' }, owner.current); setSelected(found.connection); setTools(found.tools); setToolsLoaded(true); await readTranslationModels() })} />}
      <View style={{ minHeight: 48, justifyContent: 'center' }}>{officialTool?.enabled ? <Text style={styles.subtitle}>✓ 已允许翻译正文</Text> : <PrimaryButton secondary title="允许此工具翻译正文" disabled={busy || !officialTool || !!awaitingReceipt} onPress={() => void action(async () => { if (!selected || !officialTool) return; const next = await mcpApi<MCPTool>(`/${selected.id}/tools`, { method: 'PATCH', body: JSON.stringify({ name: officialTool.name, enabled: true }) }, owner.current); setTools(current => current.map(row => row.name === next.name ? next : row)) })} />}</View>
      <Text style={styles.label}>处理模型</Text><Text style={styles.subtitle}>从当前账号的可用模型中选择。无有效默认时由你选择，不会自动切换。</Text>
      {modelOptions.map(model => <PrimaryButton key={model} title={model} secondary={model === translationModel} tertiary={model !== translationModel} disabled={busy || !!awaitingReceipt} onPress={() => setTranslationModel(model)} />)}
      <PrimaryButton tertiary title="刷新可用模型" disabled={busy || !official || !!awaitingReceipt} onPress={() => void action(readTranslationModels)} />
      <PrimaryButton secondary title="完成，返回翻译" disabled={busy} onPress={() => setAuthorizationOpen(false)} />
      <PrimaryButton tertiary title="高级连接管理" disabled={busy} onPress={() => { setAuthorizationOpen(false); setManagementOpen(true) }} />
    </BottomActionSheet>
    <BottomActionSheet visible={formOpen} title={editing ? '修改连接' : '添加连接'} onClose={() => { if (!busy) { setFormOpen(false); setToken('') } }}>
      <Field label="服务名称" value={name} onChangeText={setName} editable={!busy} maxLength={120} />
      <Field label="HTTPS 服务地址" value={url} onChangeText={setUrl} editable={!busy} placeholder="https://example.com/mcp" />
      <Field label={editing?.hasCredential ? '替换凭证（留空保留）' : 'Bearer Token（无认证可留空）'} value={token} onChangeText={setToken} editable={!busy} secureTextEntry />
      <AsyncState error={error} />
      <PrimaryButton title="保存连接" loading={busy} disabled={busy || !name.trim() || !url.trim()} onPress={() => void action(async () => {
        const body = { name: name.trim(), url: url.trim(), ...(token ? { authType: 'token', token } : editing ? {} : { authType: 'none' }) }
        await mcpApi(editing ? `/${editing.id}` : '', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) }); setToken(''); setFormOpen(false); await refresh()
      })} />
    </BottomActionSheet>
    <BottomActionSheet visible={!!tool} title={managedTranslation ? '全文翻译' : '工具调用确认'} onClose={() => { if (!busy) setTool(null) }}>
      {managedTranslation ? <><Text style={styles.noteTitle}>{pending?.source?.title || note?.title || '所选正文'}</Text><Text style={styles.subtitle}>通过 VINote 云翻译 MCP 处理所选正文。原文和已有版本保留，译文由你确认后另存。</Text></> : <><Text style={styles.noteTitle}>{selected?.name} / {tool?.name}</Text><Text selectable style={styles.subtitle}>{selected?.url}</Text><Text selectable style={styles.subtitle}>{JSON.stringify(tool?.inputSchema, null, 2)}</Text></>}
      {note && tool && !pending && !managedTranslation && <PrimaryButton secondary title={translation ? '返回普通工具调用' : '用此工具全文翻译（中文 / 英文）'} disabled={busy || translationFields(tool).length < 2} onPress={() => setTranslation(!translation)} />}
      {translation && !pending && tool && <View style={{ gap: 10 }}>
        {managedTranslation ? <Text style={styles.subtitle}>发送当前已保存正文给 VINote 云翻译，仅支持中文与英文。下一步先预览原文和目标语言，再明确执行；不会自动覆盖笔记。</Text> : <><Text style={styles.subtitle}>请选择实际翻译工具声明的正文与目标语言字段。仅发送这两项，其他必填参数或语言编码不兼容时停止，不改用内置模型。</Text>
        <Text style={styles.label}>正文参数</Text>{translationFields(tool).map(field => <PrimaryButton key={`text-${field}`} secondary={textField === field} tertiary={textField !== field} title={field} onPress={() => setTextField(field)} />)}
        <Text style={styles.label}>目标语言参数</Text>{translationFields(tool).map(field => <PrimaryButton key={`lang-${field}`} secondary={languageField === field} tertiary={languageField !== field} title={field} onPress={() => setLanguageField(field)} />)}</>}
        <View style={{ flexDirection: 'row', gap: 10 }}>{[['en', '英语'], ['zh', '简体中文']].map(([value, title]) => <PrimaryButton key={value} title={title} secondary={language === value} tertiary={language !== value} onPress={() => setLanguage(value)} />)}</View>
      </View>}
      {!managedTranslation && <TextInput accessibilityLabel={translation ? '翻译工具其他 JSON 参数' : '工具 JSON 参数'} value={argumentsText} onChangeText={setArgumentsText} editable={!busy && !pending} multiline style={[styles.input, { minHeight: 110 }]} />}
      {note && !pending && !translation && <PrimaryButton tertiary title="明确加入当前正文作为 content 参数" disabled={busy} onPress={() => { try { setArgumentsText(JSON.stringify({ ...JSON.parse(argumentsText), content: note.content }, null, 2)) } catch { setError('请先修正 JSON 参数') } }} />}
      <AsyncState error={error} />
      {pending?.run && <Text style={styles.noteTitle}>{pendingLabel}</Text>}
      {!!failureMessage && <AsyncState error={failureMessage} />}
      {managedTranslation && pending?.run?.status === 'failed' && <Text style={styles.subtitle}>本次未生成可保存的译文，原文未改动。可以核验原调用；服务恢复后再明确发起新的翻译，不会自动重试。</Text>}
      {!pending && <PrimaryButton title="预览本次调用" disabled={busy} onPress={() => void action(() => invoke())} />}
      {pending && !pending.run && <Text style={styles.subtitle}>预览回执未确认。请刷新原调用状态；不会自动创建另一条调用。</Text>}
      {pending?.run?.status === 'awaiting_confirmation' && <>{managedTranslation ? <><Text style={styles.label}>目标语言：{pending.arguments.target_language === 'zh' ? '简体中文' : '英语'}</Text><Text style={styles.subtitle}>处理模型：{String(pending.arguments.model || '已核验的服务默认模型')}</Text><Text style={styles.subtitle}>仅发送这份已保存正文（{String(pending.arguments.text || '').length} 字符）进行翻译。不会发送原始音视频，也不会发布飞书。</Text><PrimaryButton tertiary title={sourcePreviewOpen ? '收起所选原文' : '查看所选原文'} onPress={() => setSourcePreviewOpen(!sourcePreviewOpen)} />{sourcePreviewOpen && <MeetingMarkdown content={String(pending.arguments.text || '')} />}</> : <><Text selectable style={styles.noteBody}>{JSON.stringify(pending.arguments, null, 2)}</Text><Text style={styles.subtitle}>确认后会将这些参数发送到以上服务，并可能产生写入、发送或删除操作。</Text></>}<PrimaryButton title="确认并执行一次" loading={busy} disabled={busy} onPress={() => void action(() => invoke(true))} /></>}
      {pending && <PrimaryButton secondary title="刷新原调用状态" disabled={busy} onPress={() => void action(refresh)} />}
      {pending?.source && pending.run?.status === 'succeeded' && !!mcpTextResult(pending.run) && <View style={{ gap: 12 }}>
        <PrimaryButton secondary title={compareSource ? '查看译文' : '对照原文'} onPress={() => setCompareSource(!compareSource)} />
        {!!tool && <MeetingMarkdown content={compareSource ? pending.source.content : mcpTextResult(pending.run)} remoteImagePolicy="confirm" imageSessionKey={`${owner.current}:${pending.requestId}`} />}
        <Text style={styles.subtitle}>确认后保存为当前正文的新版本，原文保留。不自动发布飞书。</Text>
        <PrimaryButton title={savedResult ? '译文已保存' : '保存译文为新版本'} disabled={busy || savedResult} onPress={() => void action(saveTranslationResult)} />
      </View>}
    </BottomActionSheet>
  </View>
}
