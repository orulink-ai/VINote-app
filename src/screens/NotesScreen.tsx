import { Text } from '../components/AppText'
import React, { useCallback, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { PrimaryButton } from '../components/PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { markdownPreview } from '../lib/markdown'
import { Field } from '../components/Field'
import { listNotes } from '../lib/notes'
import type { Note } from '../types/api'
import { subscribeWorkspace } from '../lib/workspace'
import { AsyncState } from '../components/AsyncState'
import { ContentIntake } from '../components/ContentIntake'
import { groupMeetings, isMeetingGroup, type MeetingRow } from '../lib/meetingGroups'
import { readMeetingGroupSources } from '../lib/meetingGroupSources'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'

/** Parent retains separate view snapshots per category; this contains no note data. */
export type NotesView = { query: string; filter: string; project: string }

export function NotesScreen({
  onOpen,
  onNew,
  revision,
  onRecord,
  onImport,
  initialProject = '',
  onBack,
  onOriginals,
  kind = 'all',
  onChangeKind,
  view,
  onViewChange,
  initialNotes,
  onNotesChange,
}: {
  onOpen: (id: string) => void
  onNew?: () => void
  revision?: number
  onRecord?: () => void
  onImport?: (mode?: 'url' | 'file') => void
  initialProject?: string
  onBack?: () => void
  onOriginals?: () => void
  kind?: 'all' | 'meeting' | 'note'
  onChangeKind?: (kind: 'meeting' | 'note') => void
  view?: NotesView
  onViewChange?: (value: NotesView) => void
  initialNotes?: Note[]
  onNotesChange?: (notes: Note[]) => void
}) {
  const [localView, setLocalView] = useState<NotesView>({ query: '', filter: '全部', project: initialProject })
  const currentView = view ?? localView
  const { query, filter } = currentView
  const project = initialProject || currentView.project
  const updateView = (patch: Partial<NotesView>) => {
    const next = { ...currentView, ...patch }
    next.project = initialProject || next.project
    if (!view) setLocalView(next)
    onViewChange?.(next)
  }
  const [batch, setBatch] = useState(() => ({ notes: initialNotes ?? [], epoch: identityEpoch() }))
  const { notes, epoch: rowEpoch } = batch
  const [loading, setLoading] = useState(initialNotes === undefined)
  const [error, setError] = useState('')
  const [sourceProof, setSourceProof] = useState<Awaited<ReturnType<typeof readMeetingGroupSources>>>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const loadEpoch = useRef(0)
  const sourceRead = useRef(0)
  const refreshing = useRef(false)
  const readPending = useRef<Promise<void> | null>(null)
  const readAgain = useRef(false)
  const hasCache = useRef(initialNotes !== undefined)
  const onRows = useRef(onNotesChange)
  onRows.current = onNotesChange
  const load = useCallback(() => {
    if (readPending.current) { readAgain.current = true; return readPending.current }
    const epoch = ++loadEpoch.current
    if (!hasCache.current) setLoading(true)
    const job = (async () => {
      do {
        readAgain.current = false
        try {
          const sourceRequest = ++sourceRead.current
          const identity = identityEpoch()
          const result = await listNotes()
          if (identity !== identityEpoch()) return
          if (epoch !== loadEpoch.current) return
          hasCache.current = true
          setSourceProof(undefined)
          setBatch({ notes: result, epoch: identity }); setError(''); onRows.current?.(result)
          // Bodies are ready independently of original metadata. Only this exact
          // list read may enrich its display, never a newer list or another identity.
          if (kind !== 'note' && result.some(note => (note.source_type || '').startsWith('meeting'))) {
            void readMeetingGroupSources(result).then(proof => {
              if (identity === identityEpoch() && proof.epoch === identity && epoch === loadEpoch.current && sourceRequest === sourceRead.current) setSourceProof(proof)
            }).catch(() => { /* Keep the independent complete bodies readable. */ })
          }
        } catch (e) {
          if (epoch === loadEpoch.current) setError(e instanceof Error ? e.message : '加载失败，请重试')
        } finally {
          if (epoch === loadEpoch.current) setLoading(false)
        }
      } while (readAgain.current && epoch === loadEpoch.current)
    })()
    readPending.current = job
    void job.finally(() => { if (readPending.current === job) readPending.current = null })
    return job
  }, [kind])
  const refresh = useCallback(async () => {
    if (refreshing.current) return
    const identity = identityEpoch()
    refreshing.current = true
    setLoading(true)
    try { await load() }
    catch (cause) { if (identity === identityEpoch()) setError(cause instanceof Error ? cause.message : '读取失败，已保存内容仍可阅读') }
    finally { if (identity === identityEpoch()) { refreshing.current = false; setLoading(false) } }
  }, [load])
  React.useEffect(() => {
    void load()
    const unsubscribe = subscribeWorkspace(() => void load())
    return unsubscribe
  }, [load, revision])
  React.useEffect(() => () => { ++loadEpoch.current; ++sourceRead.current }, [])
  React.useEffect(() => subscribeIdentity(() => {
    ++loadEpoch.current; ++sourceRead.current
    readPending.current = null; readAgain.current = false; hasCache.current = false
    refreshing.current = false
    setSourceProof(undefined); setExpanded(new Set()); setBatch({ notes: [], epoch: identityEpoch() }); setLoading(false); setError('')
  }), [])
  const contentLabel = kind === 'meeting' ? '会议' : kind === 'note' ? '笔记' : '内容'
  const hasFilters = !!query.trim() || filter !== '全部' || (!initialProject && !!project)
  const clearFilters = () => updateView({ query: '', filter: '全部', project: initialProject })
  const projects = [...new Set(notes.map(note => note.project).filter((value): value is string => !!value))]
  // Filter each content object first; expanding never reveals archived/project/search exclusions.
  const visible = notes.filter(note => !note.deleted && (kind === 'all' || ((note.source_type || '').startsWith('meeting') ? kind === 'meeting' : kind === 'note'))).filter(note => !project || note.project === project).filter(note => (filter === '归档' ? note.archived : !note.archived) && (filter === '文字' ? ['text', 'file', 'document', 'transcript'].includes(note.source_type || '') : filter === '会议' ? (note.source_type || '').startsWith('meeting') : filter === '音视频' ? ['audio', 'video'].includes(note.source_type || '') : true)).filter(note => !query.trim() || (note.title + markdownPreview(note.content) + (note.tags || []).join(' ')).toLowerCase().includes(query.trim().toLowerCase()))
  const grouped = sourceProof && sourceProof.epoch === identityEpoch() && kind !== 'note'
    ? groupMeetings(visible, sourceProof.owner, sourceProof.sources) : visible
  const rows: MeetingRow[] = grouped.flatMap(row => isMeetingGroup(row) && expanded.has(row.id) ? [row, ...row.notes] : [row])
  const filters = <View style={{ gap: 10, marginBottom: 12 }}><View style={{ gap: 6, paddingVertical: 8 }}>
    <Field hideLabel label={`搜索${contentLabel}`} value={query} onChangeText={value => updateView({ query: value })} placeholder="搜索标题、正文或标签" style={{ minHeight: 44, paddingVertical: 8, backgroundColor: colors.canvas }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {(kind === 'meeting' ? ['全部', '归档'] : ['全部', '文字', '音视频', '归档']).map(label => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: label === filter }} onPress={() => updateView({ filter: label })} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 14, justifyContent: 'center', backgroundColor: label === filter ? colors.primarySoft : 'transparent' }}><Text style={[styles.subtitle, { color: label === filter ? colors.ink : colors.muted }]}>{label === '文字' ? '文档与文字' : label}</Text></Pressable>)}
    </View>
    {!initialProject && projects.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
      {['', ...projects].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: project === value }} onPress={() => updateView({ project: value })} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 14, backgroundColor: project === value ? colors.primarySoft : 'transparent' }}><Text numberOfLines={1} style={styles.subtitle}>{value || '全部项目'}</Text></Pressable>)}
    </ScrollView>}
    </View>
    <AsyncState error={error} retryLabel="重新读取" onRetry={() => void refresh()} />
  </View>
  return (
    <View style={styles.screen}>
      <ScreenHeader title={initialProject || (kind === 'meeting' ? '会议' : '笔记')} onBack={onBack} backLabel="返回项目" right={kind === 'meeting' && onRecord ? <PrimaryButton title="录制会议" onPress={onRecord} /> : onNew && kind !== 'meeting' && <PrimaryButton secondary title="写笔记" onPress={onNew} />} />
      {onChangeKind && <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', gap: 8 }}>{([{ kind: 'meeting', label: '会议' }, { kind: 'note', label: '笔记' }] as const).map(item => <Pressable key={item.kind} accessibilityRole="tab" accessibilityState={{ selected: kind === item.kind }} accessibilityLabel={item.label} onPress={() => onChangeKind(item.kind)} style={{ minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 14, backgroundColor: kind === item.kind ? colors.primarySoft : colors.canvas }}><Text style={styles.noteTitle}>{item.label}</Text></Pressable>)}</View>}
      {kind === 'meeting' && onImport && <View style={{ paddingHorizontal: 16 }}><PrimaryButton secondary title="导入音频" onPress={() => onImport()} /></View>}
      {kind === 'meeting' && onOriginals && <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}><PrimaryButton secondary title="查看录音与会议资料" onPress={onOriginals} /><Text style={styles.subtitle}>已保存的录音可从这里继续生成纪要；原文件在文件库中管理。</Text></View>}
      {kind !== 'meeting' && onImport && <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><ContentIntake onImport={onImport} /></View>}
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 16,
          gap: 8,
        }}
        data={rows}
        extraData={expanded}
        refreshing={loading}
        onRefresh={() => void refresh()}
        keyExtractor={item => item.id}
        ListHeaderComponent={filters}
        ListEmptyComponent={
          !error ? (
            <View style={[styles.emptyState]}>
              <Text style={styles.noteTitle}>
                {loading
                  ? '正在加载…'
                  : hasFilters
                  ? `没有找到匹配的${contentLabel}`
                  : kind === 'meeting' ? `${initialProject ? '当前项目' : ''}还没有会议纪要` : `${initialProject ? '当前项目' : ''}还没有保存的${contentLabel}`}
              </Text>
              {!loading && <Text style={styles.subtitle}>
                {hasFilters
                  ? '试试其他关键词，或清除筛选。'
                  : kind === 'meeting' ? '保存录音后，生成的纪要才显示在这里。已有录音请从“查看录音与会议资料”继续处理。' : '粘贴网页或视频链接、导入 PDF、Word 或音视频生成总结笔记，也可以直接写笔记。'}
              </Text>}
              {!loading && hasFilters && <PrimaryButton tertiary title="清除筛选" onPress={clearFilters} />}
            </View>
          ) : undefined
        }
        renderItem={({ item }) => isMeetingGroup(item) ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.has(item.id) }}
            accessibilityLabel={`${item.notes[0].title.slice(0, 120)}，同一会议的${item.notes.length}份纪要，${expanded.has(item.id) ? '收起' : '展开'}`}
            onPress={() => { if (rowEpoch !== identityEpoch()) return; setExpanded(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next }) }}
            style={[styles.listRow, { padding: 14, borderRadius: 12, gap: 6, backgroundColor: colors.card, minHeight: 44 }]}>
            <Text style={styles.eyebrow}>同一会议 · {item.notes.length}份纪要</Text>
            <Text numberOfLines={2} style={styles.noteTitle}>{item.notes[0].title}</Text>
            <Text style={styles.subtitle}>{expanded.has(item.id) ? '收起纪要' : '展开查看各份纪要'}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessible
            accessibilityLabel={`${item.title.slice(0, 120)}，${(item.source_type || '').startsWith('meeting') ? '会议纪要' : item.source_type === 'text' ? '文字笔记' : '总结笔记'}，当前正文`}
            style={({ pressed }) => [
              styles.listRow,
              { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 14 },
              { backgroundColor: pressed ? colors.primarySoft : colors.card },
            ]}
            onPress={() => { if (rowEpoch === identityEpoch()) onOpen(item.id) }}
          >
            <WorkspaceIcon name={(item.source_type || '').startsWith('meeting') ? 'record' : 'content'} muted />
            <View style={{ flex: 1, gap: 6 }}><View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Text style={styles.eyebrow}>
                {(item.source_type || '').startsWith('meeting') ? '会议纪要' : item.source_type === 'text' ? '文字笔记' : '总结笔记'} · 当前正文
              </Text>
              <Text style={[styles.subtitle, { fontSize: 12 }]}>
                {item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '来源日期未保存'}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.noteTitle}>{item.title}</Text>
            {!!item.source_device && item.source_type !== 'text' && !item.task_id && <Text style={styles.subtitle}>来源设备：{item.source_device}</Text>}
            <Text numberOfLines={2} style={styles.subtitle}>
              {markdownPreview(item.content)}
            </Text>
            </View><Text style={{ fontSize: 20, color: colors.muted }}>›</Text>
          </Pressable>
        )}
      />
    </View>
  )
}
