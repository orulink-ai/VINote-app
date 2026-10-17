import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../components/AppText'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomActionSheet } from '../components/BottomActionSheet'
import { AsyncState } from '../components/AsyncState'
import { MeetingMarkdown } from '../components/MeetingMarkdown'
import { colors, styles } from '../design-system/theme'
import { readAccountId } from '../lib/storage'
import { fetchWorkspaceNote, readWorkspace } from '../lib/workspace'
import type { WorkspaceNote } from '../lib/workspaceStorage'
import type { Note } from '../types/api'
import { createTextNote } from '../lib/notes'
import { clearPluginIntent, newPluginIntent, pluginCatalog, pluginLabel, pluginRun, pluginRuns, pluginSetting, readPluginIntent, retryPlugin, savePlugin, submitPlugin, type ContentPlugin, type PluginIntent, type PluginRun } from '../lib/contentPlugins'

const languages = [['en', '英语'], ['zh', '简体中文']]
export function ContentPluginsScreen({ onBack, onOpen, note: initialNote, initialPlugin = 'diagram' }: { onBack: () => void; onOpen: (id: string) => void; note?: Note; initialPlugin?: 'translation' | 'diagram' }) {
  const [owner, setOwner] = useState('')
  const ownerRef = useRef(''), mounted = useRef(true), lock = useRef(false)
  const [catalog, setCatalog] = useState<ContentPlugin[]>([]), [records, setRecords] = useState<PluginRun[]>([])
  const [notes, setNotes] = useState<WorkspaceNote[]>([]), [source, setSource] = useState<WorkspaceNote | null>(null)
  const [plugin, setPlugin] = useState<'translation' | 'diagram'>(initialPlugin), [language, setLanguage] = useState('en'), [version, setVersion] = useState('')
  const [intent, setIntent] = useState<PluginIntent | null>(null), [run, setRun] = useState<PluginRun | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [picker, setPicker] = useState<'note' | 'version' | null>(null), [view, setView] = useState<'source' | 'result'>('result')
  const valid = async (id: string) => mounted.current && ownerRef.current === id && await readAccountId() === id
  const load = async (id: string) => {
    const result = await Promise.allSettled([pluginCatalog(id), pluginRuns(id), readWorkspace(id)])
    if (!await valid(id)) return
    if (result[0].status === 'fulfilled') setCatalog(result[0].value)
    if (result[1].status === 'fulfilled') setRecords(result[1].value)
    if (result[2].status === 'fulfilled') setNotes(Object.values(result[2].value.cache).filter(n => !n.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    const failed = result.find(item => item.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  const selectSource = async (id: string, key: string) => {
    const value = await fetchWorkspaceNote(key, id)
    if (await valid(id)) { setSource(value); setVersion(`__vinote:current:${value.revision}`) }
  }
  const act = async (work: (id: string) => Promise<void>) => {
    if (lock.current || !ownerRef.current) return
    lock.current = true; setBusy(true); setError('')
    const id = ownerRef.current
    try { await work(id) } catch (cause) { if (await valid(id)) setError((cause as Error).message) }
    finally { lock.current = false; if (await valid(id)) setBusy(false) }
  }
  useEffect(() => {
    mounted.current = true
    void (async () => {
      const id = await readAccountId()
      if (!id || !mounted.current) throw new Error('请重新登录')
      ownerRef.current = id; setOwner(id)
      await load(id)
      const saved = await readPluginIntent(id)
      if (!await valid(id)) return
      if (saved) {
        setIntent(saved); setPlugin(saved.plugin_id); setLanguage(saved.language)
        try { const result = await pluginRun(id, saved.operation_id); if (await valid(id)) setRun(result) }
        catch (cause) { if (await valid(id)) setError(`原处理结果待核验：${(cause as Error).message}。保留原操作，不重复提交。`) }
      } else if (initialNote) {
        const state = await readWorkspace(id)
        const mapping = Object.values(state.mappings).find(row => row.localIds.includes(initialNote.id))
        const key = initialNote.workspace_key || mapping?.key
        if (key) await selectSource(id, key)
        else setError('当前图表服务仍依赖旧共享资料，尚未支持直接处理设备正文。不会上传资料或用旧正文替代。')
      }
    })().catch(cause => { if (mounted.current) setError((cause as Error).message) }).finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false; ownerRef.current = '' }
  }, [])
  const selected = catalog.find(item => item.id === plugin)
  const sourceText = run?.source_content || (!run && source ? (version.startsWith('__vinote:current:') ? source.content : source.versions.find(v => v.id === version)?.content || '') : '')
  const query = () => void act(async id => { if (!intent && !run) return; const value = await pluginRun(id, run?.id || intent!.operation_id); if (await valid(id)) setRun(value); await load(id) })
  return <View style={styles.screen}>
    <ScreenHeader title="流程图历史记录" onBack={onBack} backLabel={initialNote ? '返回内容详情' : '返回插件'} />
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={styles.subtitle}>查看原处理记录与已返回结果；不再发起或重试生成。原文与原始文件保留。</Text>
      <AsyncState loading={loading || busy} error={error} loadingLabel={loading ? '读取插件、版本和原处理记录…' : '正在处理当前操作，关闭后可从记录核验…'} onRetry={intent || run ? query : () => void act(id => load(id))} retryLabel={intent || run ? '核验原处理结果' : '重新读取'} />
      {!run && !intent && <Text style={styles.subtitle}>新的流程图生成已停止。可在下方查看历史记录与已保存结果。</Text>}
      {(intent || run) && <View style={[styles.card, { gap: 12 }]}>
        <Text accessibilityRole="header" style={styles.noteTitle}>{run ? pluginLabel(run.status) : '提交结果待核验'}</Text>
        <Text style={styles.subtitle}>{run?.source_title || source?.title || '已冻结的源内容'} · 源修订 {run?.base_revision || intent?.base_revision} · {languages.find(([id]) => id === (run?.language || intent?.language))?.[1] || '流程图整理'}</Text>
        {!!run?.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{run.error}</Text>}
        <PrimaryButton secondary title="核验原处理结果" disabled={busy} onPress={query} />
        {!!run?.output && <>
          <View style={{ flexDirection: 'row', gap: 12 }}><PrimaryButton secondary={view === 'source'} tertiary={view !== 'source'} title="原文" onPress={() => setView('source')} /><PrimaryButton secondary={view === 'result'} tertiary={view !== 'result'} title={run.plugin_id === 'translation' ? '译文' : '流程图与依据'} onPress={() => setView('result')} /></View>
          {view === 'source' && !run.source_content ? <Text style={styles.subtitle}>此运行的固定原文尚未返回，请核验原记录。不会使用最新正文冒充源版本。</Text> : <View><MeetingMarkdown content={view === 'source' ? run.source_content! : run.output} /></View>}
          {run.status === 'ready' && <><Text style={styles.subtitle}>保存后作为当前版本，原文保留在源版本中；不会发布到飞书。</Text><PrimaryButton title="保存为新版本" disabled={busy} onPress={() => void act(async id => { if (!await valid(id)) return; const saved = await createTextNote(run.source_title || '流程图整理结果', run.output, `plugin-${run.id}`, id); if (await valid(id)) onOpen(saved.id) })} /></>}
          {run.status === 'saved' && <PrimaryButton title="查看新版本" onPress={() => void act(async id => { if (!run.output) throw new Error('原结果未返回，请核验原记录'); const saved = await createTextNote(run.source_title || '流程图整理结果', run.output, `plugin-${run.id}`, id); if (await valid(id)) onOpen(saved.id) })} />}
        </>}
      </View>}
      <View style={{ gap: 10 }}><Text style={styles.noteTitle}>处理记录</Text>{records.length === 0 && !loading && <Text style={styles.subtitle}>尚无内容插件历史记录。</Text>}{records.map(record => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`${record.plugin_id === 'translation' ? '全文翻译' : '流程图整理'}，${pluginLabel(record.status)}`} disabled={busy} onPress={() => void act(async id => { const result = await pluginRun(id, record.id); if (await valid(id)) { setRun(result); setIntent(null); setView('result') } })} style={{ minHeight: 56, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line }}><Text>{record.plugin_id === 'translation' ? '全文翻译' : record.plugin_id === 'diagram' ? '流程图整理' : '内容处理'} · {pluginLabel(record.status)}</Text><Text style={styles.subtitle}>{new Date(record.created_at).toLocaleString()}</Text></Pressable>)}</View>
    </ScrollView>
    <BottomActionSheet visible={!!picker} title={picker === 'version' ? '选择源版本' : '选择会议或笔记'} onClose={() => setPicker(null)}>
      {picker === 'note' ? notes.map(note => <PrimaryButton key={note.key} tertiary title={note.title} onPress={() => { setPicker(null); void act(id => selectSource(id, note.key)) }} />) : source && [{ id: `__vinote:current:${source.revision}`, title: '最新已保存正文', created_at: source.updated_at }, ...source.versions].map(row => <PrimaryButton key={row.id} tertiary title={`${row.title} · ${new Date(row.created_at).toLocaleString()}`} onPress={() => { setVersion(row.id); setPicker(null) }} />)}
      {picker === 'note' && notes.length === 0 && <Text style={styles.subtitle}>请从内容详情查看已保存正文；新图表处理等待直接正文接口。</Text>}
    </BottomActionSheet>
  </View>
}
