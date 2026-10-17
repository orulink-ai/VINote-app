import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, findNodeHandle, Alert, FlatList, Pressable, ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { Text } from '../components/AppText'
import { Field } from '../components/Field'
import { PrimaryButton } from '../components/PrimaryButton'
import { AsyncState } from '../components/AsyncState'
import { BottomActionSheet } from '../components/BottomActionSheet'
import { colors, styles } from '../design-system/theme'
import { listRecordings, type LocalRecording } from '../features/recording/recordingLibrary'
import { listLocalFiles, listLocalFileLinks, importLocalFile, setLocalFilePurpose, exportLocalFile, deleteLocalFile, readTextFile, type LocalFile, type LocalFileLink, type FilePurpose } from '../lib/localFiles'
import { createTextNote } from '../lib/notes'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { readAccountId } from '../lib/storage'
import { formatDuration } from '../lib/formatDuration'
import { noteSourceFiles } from '../lib/noteSourceFiles'
import type { Note } from '../types/api'

type Row = { id: string; title: string; category: string; purpose?: FilePurpose; date: string; record?: LocalRecording; file?: LocalFile }
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`
const filters = [{ id: 'all', title: '全部' }, { id: 'audio', title: '音频' }, { id: 'video', title: '视频' }, { id: 'document', title: '文档' }]
const normalizedCategory = (value?: string) => value === 'recording' ? 'audio' : value === 'screen' ? 'video' : value === 'file' ? 'document' : filters.some(item => item.id === value) ? value! : 'all'
const sourceBadge = (row: Row) => row.record ? row.record.source === 'import' ? '导入音频' : '录音' : row.file?.source === 'bilibili' ? 'B站音频' : row.file?.source === 'screen_recording' ? '录屏' : row.file?.source === 'import' ? row.category === 'video' ? '导入视频' : row.category === 'audio' ? '导入音频' : '导入文档' : ''
const purposes = [{ id: 'meeting' as const, title: '会议资料' }, { id: 'note' as const, title: '笔记资料' }]
export type FileLibraryView = { purpose?: FilePurpose; category: string; query: string; unassigned?: boolean }
export function FileLibraryScreen({ onRecording, onOpenNote, onSummarize, view, onViewChange, sourceNote, onBack }: { onRecording: (id: string) => void; onOpenNote: (id: string) => void; onSummarize?: (file: LocalFile) => void; view?: FileLibraryView; onViewChange?: (value: FileLibraryView) => void; sourceNote?: Note; onBack?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]), [category, setCategory] = useState(normalizedCategory(view?.category)), [query, setQuery] = useState(view?.query || '')
  const [purpose, setPurpose] = useState<FilePurpose>(view?.purpose || 'meeting'), [unassigned, setUnassigned] = useState(!!view?.unassigned)
  const [selected, setSelected] = useState<LocalFile | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<LocalFileLink[]>([]), [linksError, setLinksError] = useState(''), [linksLoading, setLinksLoading] = useState(false)
  const owner = useRef(''), selectedRef = useRef(selected)
  selectedRef.current = selected
  const epoch = useRef(0)
  const mounted = useRef(true), confirmation = useRef(0), operationLock = useRef(false)
  const route = sourceNote ? `source:${sourceNote.id}` : 'library'
  const routeRef = useRef(route); routeRef.current = route
  const detailsRef = useRef<React.ElementRef<typeof View>>(null)
  const restoreFocus = useRef<null | (() => boolean)>(null)
  useEffect(() => {
    mounted.current = true
    const remove = subscribeIdentity(() => { confirmation.current++; restoreFocus.current = null; epoch.current++; setSelected(null); setRows([]) })
    return () => { mounted.current = false; confirmation.current++; restoreFocus.current = null; remove() }
  }, [])
  useEffect(() => { confirmation.current++; restoreFocus.current = null; setSelected(null) }, [route])
  const load = useCallback(async () => {
    const run = ++epoch.current; setLoading(true); setError('')
    try {
    const account = await readAccountId()
    if (!account) throw new Error('请登录后管理文件')
    if (owner.current && owner.current !== account) { setRows([]); setSelected(null) }
    owner.current = account
    const result = await Promise.allSettled([sourceNote ? Promise.resolve([]) : listRecordings(), sourceNote ? noteSourceFiles(sourceNote, account) : listLocalFiles(account)])
    if (run !== epoch.current || await readAccountId() !== account) return
    setRows(previous => {
      const recordings = result[0].status === 'fulfilled' ? result[0].value : previous.flatMap(row => row.record ? [row.record] : [])
      const files = result[1].status === 'fulfilled' ? result[1].value : previous.flatMap(row => row.file ? [row.file] : [])
      return [...recordings.map(record => ({ id: `recording:${record.id}`, title: record.title, category: 'audio', purpose: 'meeting' as const, date: record.createdAt, record })), ...files.map(file => ({ id: `file:${file.id}`, title: file.name, category: file.category === 'file' ? 'document' : file.category, purpose: file.source === 'screen_recording' ? 'meeting' as const : file.purpose, date: file.createdAt, file }))].sort((a, b) => b.date.localeCompare(a.date))
    })
    if (result.some(row => row.status === 'rejected')) setError('部分文件读取失败，已读取文件仍可使用，请重试。')
    } catch (cause) { if (run === epoch.current) setError(cause instanceof Error ? cause.message : '文件读取失败') }
    finally { if (run === epoch.current) setLoading(false) }
  }, [sourceNote])
  useEffect(() => { void load(); return () => { epoch.current++ } }, [load])
  useEffect(() => { onViewChange?.({ purpose, category, query, unassigned }) }, [purpose, category, query, unassigned, onViewChange])
  useEffect(() => {
    let active = true
    setLinks([]); setLinksError(''); setLinksLoading(!!selected)
    const account = owner.current
    if (selected && account) void listLocalFileLinks(selected, account).then(async result => {
      if (active && await readAccountId() === account && active) setLinks(result)
    }).catch(cause => { if (active) setLinksError(cause instanceof Error ? cause.message : '原件关联读取失败') }).finally(() => { if (active) setLinksLoading(false) })
    return () => { active = false }
  }, [selected])
  const perform = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，请重试') } finally { setBusy(false) } }
  const remove = (file: LocalFile) => {
    if (!mounted.current || operationLock.current || busy || selectedRef.current?.id !== file.id || !owner.current) return
    const sequence = ++confirmation.current, account = owner.current, identity = identityEpoch(), parent = route
    const current = () => mounted.current && confirmation.current === sequence && routeRef.current === parent && identityEpoch() === identity && owner.current === account && (!selectedRef.current || selectedRef.current.id === file.id)
    setSelected(null)
    let decided = false
    const cancel = async () => {
      if (decided) return
      decided = true
      if (!current()) return
      if (await readAccountId() !== account || !current()) return
      restoreFocus.current = current
      setSelected(file)
    }
    Alert.alert('删除此设备上的原始文件？', '已保存的笔记、纪要和版本保留。删除原始文件后无法恢复。', [
      { text: '取消', style: 'cancel', onPress: () => { void cancel().catch(() => {}) } },
      { text: '删除文件', style: 'destructive', onPress: () => {
        if (decided || !current() || operationLock.current) return
        decided = true
        operationLock.current = true; setBusy(true); setError('')
        void (async () => {
          try { if (await readAccountId() !== account || !current()) return; await deleteLocalFile(file, account, identity, current); if (current()) await load() }
          catch (cause) { if (current()) { setError(cause instanceof Error ? cause.message : '删除未完成，请核对原文件'); restoreFocus.current = current; setSelected(file) } }
          finally { operationLock.current = false; if (current()) setBusy(false) }
        })()
      } },
    ], { cancelable: true, onDismiss: () => { void cancel().catch(() => {}) } })
  }
  const unassignedCount = rows.filter(row => !row.purpose).length
  const visible = sourceNote ? rows : rows.filter(row => (unassigned ? !row.purpose : row.purpose === purpose) && (category === 'all' || row.category === category) && row.title.toLowerCase().includes(query.trim().toLowerCase()))
  const assignPurpose = (file: LocalFile, next: FilePurpose) => void perform(async () => {
    const account = owner.current, run = epoch.current
    await setLocalFilePurpose(file, next, account)
    if (run !== epoch.current || await readAccountId() !== account) return
    setSelected(null); setPurpose(next); setUnassigned(false); setCategory('all'); await load()
  })
  const openLinkedNote = (file: LocalFile, link: LocalFileLink) => void perform(async () => {
    const account = owner.current, run = epoch.current
    const latest = (await listLocalFileLinks(file, account)).find(row => row.association.operationId === link.association.operationId)
    if (!latest?.noteId) throw new Error('关联笔记当前不可用，请从处理记录核对；原文件保留')
    if (run !== epoch.current || selectedRef.current?.id !== file.id || await readAccountId() !== account) return
    setSelected(null); onOpenNote(latest.noteId)
  })
  return <View style={styles.screen}><ScreenHeader title={sourceNote ? '来源文件' : '文件库'} onBack={onBack} backLabel="返回内容详情" right={!sourceNote && <PrimaryButton secondary title={purpose === 'meeting' ? '导入会议资料' : '导入笔记资料'} loading={busy} onPress={() => void perform(async () => { await importLocalFile({ purpose, expectedOwner: owner.current }); await load() })} />} />
    {sourceNote ? <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 10 }}><Text style={styles.noteTitle}>{sourceNote.title}</Text><Text style={styles.subtitle}>只显示这份内容在此设备保留的来源文件。原始文件与正文独立保留。</Text><AsyncState error={error} onRetry={() => void load()} /><Text style={styles.subtitle}>{loading ? '正在核对来源…' : `${visible.length} 个来源文件`}</Text></View> : (
      <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{purposes.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.title} accessibilityState={{ selected: !unassigned && purpose === item.id }} onPress={() => { setPurpose(item.id); setUnassigned(false); setCategory('all') }} style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: !unassigned && purpose === item.id ? colors.primarySoft : colors.card }}><Text style={[styles.noteTitle, !unassigned && purpose === item.id && { color: colors.navigationAccent }]}>{item.title}</Text></Pressable>)}</View>
        <Text style={styles.subtitle}>{unassigned ? '旧文件用途待确认；不会按名称或格式猜测。选择文件后归入会议或笔记资料，原文件与关联保留。' : purpose === 'meeting' ? '录音、录屏与为会议导入的资料。导入仅保留原件，不自动生成纪要。' : '为笔记导入的文档、音视频与文字。链接没有原文件，不在这里显示。'}</Text>
        {!!unassignedCount && <Pressable accessibilityRole="button" accessibilityLabel={`选择旧文件用途（${unassignedCount}）`} onPress={() => { setUnassigned(true); setCategory('all'); setQuery('') }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.link}>选择旧文件用途（{unassignedCount}）</Text></Pressable>}
        <Field label="搜索文件" hideLabel value={query} onChangeText={setQuery} placeholder="搜索文件名称" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>{filters.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.title} accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: category === item.id ? colors.primarySoft : 'transparent' }}><Text style={[styles.subtitle, category === item.id && { color: colors.navigationAccent, fontWeight: '500' }]}>{item.title}</Text></Pressable>)}</ScrollView>
        <AsyncState error={error} onRetry={() => void load()} /><Text style={styles.subtitle}>{loading ? '正在读取文件…' : `${visible.length} 个文件 · ${unassigned ? '用途待确认' : purpose === 'meeting' ? '会议资料' : '笔记资料'}`}</Text>
      </View>
    )}
    <FlatList data={visible} keyExtractor={row => row.id} refreshing={loading} onRefresh={() => void load()} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} ListEmptyComponent={!error ? <View style={styles.emptyState}><Text style={styles.noteTitle}>{loading ? '正在读取文件…' : sourceNote ? '此设备没有保留这份来源文件' : query.trim() || category !== 'all' ? '没有匹配文件' : '这里还没有文件'}</Text><Text style={styles.subtitle}>{sourceNote ? '可继续查看正文与全部版本；请在导入这份文件的设备上管理原文件。旧内容未记录来源时，不会按名称猜测关联。' : query.trim() || category !== 'all' ? '换一个关键词，或选择全部格式查看当前资料。' : '录制与导入的原始文件会显示在这里。导入只保留原件，不自动生成内容。'}</Text></View> : undefined} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`打开文件 ${item.title}`} disabled={busy} onPress={() => item.record ? onRecording(item.record.id) : setSelected(item.file?.source === 'screen_recording' ? { ...item.file, purpose: 'meeting' } : item.file!)} style={({ pressed }) => [styles.listRow, { paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? colors.primarySoft : colors.card }]}><WorkspaceIcon name={item.category === 'audio' ? 'record' : 'content'} /><View style={{ flex: 1, gap: 6 }}><Text numberOfLines={2} style={styles.noteTitle}>{item.title}</Text><Text style={styles.subtitle}>{filters.find(filter => filter.id === item.category)?.title}{sourceBadge(item) ? ` · ${sourceBadge(item)}` : ''} · {item.file ? fileSize(item.file.size) : formatDuration(item.record?.duration)} · {new Date(item.date).toLocaleDateString()}</Text></View><Text style={styles.subtitle}>›</Text></Pressable>} />
    <BottomActionSheet visible={!!selected} title={selected?.name || '文件详情'} onShown={() => {
          if (restoreFocus.current?.()) { const handle = findNodeHandle(detailsRef.current); if (handle != null) { restoreFocus.current = null; AccessibilityInfo.setAccessibilityFocus(handle) } }
        }} onClose={() => { if (!busy) setSelected(null) }}>
      {selected && <><View ref={detailsRef} accessible accessibilityLabel={`文件详情 ${selected.name}`} style={{ gap: 6 }}><Text style={styles.label}>文件信息</Text><Text style={styles.subtitle}>{selected.extension.toUpperCase()} · {fileSize(selected.size)} · {new Date(selected.createdAt).toLocaleDateString()}</Text><Text style={styles.subtitle}>原始文件独立保留。</Text></View>
        {!sourceNote && !selected.purpose && <View style={{ gap: 10, paddingVertical: 12 }}><Text style={styles.label}>选择资料用途</Text><Text style={styles.subtitle}>只保存用途分类，不移动原件、不发出处理请求，也不改变已保存正文。</Text><PrimaryButton secondary title="归入会议资料" loading={busy} onPress={() => assignPurpose(selected, 'meeting')} /><PrimaryButton secondary title="归入笔记资料" disabled={busy} onPress={() => assignPurpose(selected, 'note')} /></View>}
        <BilibiliSourceInfo source={selected.bilibiliSource} />
        {!sourceNote && <View style={{ gap: 10, paddingVertical: 12 }}><Text style={styles.label}>关联内容与处理状态</Text>{linksLoading && <Text style={styles.subtitle}>正在读取关联内容…</Text>}{!linksLoading && !linksError && !links.length && <Text style={styles.subtitle}>尚无可核验的关联内容；不会从名称或旧正文推断来源。</Text>}{links.map(link => <View key={link.association.operationId} style={{ gap: 6 }}>
          <Text style={styles.subtitle}>{link.association.state === 'saved' ? link.noteId ? '正文已保存 · 原件在此设备' : '正文曾保存，当前未缓存或已移除' : link.association.state === 'prepared' ? '来源已登记，尚未发出处理请求' : link.association.state === 'unknown' ? '原提交待核验，不自动重新提交' : link.association.state === 'reserved' ? '原提交已登记，排队尚未确认' : '原任务已接收，笔记尚未保存'}</Text>
          {link.noteId && <PrimaryButton secondary={links.filter(value => value.noteId).length !== 1} title={`查看关联笔记：${link.noteTitle || '已保存笔记'}`} disabled={busy} onPress={() => openLinkedNote(selected, link)} />}
        </View>)}{!!linksError && <AsyncState error={linksError} onRetry={() => setSelected(file => file ? { ...file } : null)} />}</View>}
        {!sourceNote && selected.purpose === 'note' && <View style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line }}><Text style={styles.label}>整理为笔记</Text>{onSummarize && <PrimaryButton secondary={links.some(link => !!link.noteId)} title={links.some(link => !!link.noteId) ? '再生成一份笔记' : '生成总结笔记'} disabled={busy} onPress={() => { const file = selected; setSelected(null); onSummarize(file) }} />}<Text style={styles.subtitle}>先核对所选文件，点击生成才提交处理。原文件保留。</Text>
        {['md', 'txt', 'srt', 'vtt'].includes(selected.extension) && <PrimaryButton secondary title="保存原文为笔记" loading={busy} onPress={() => void perform(async () => { const content = await readTextFile(selected); const note = await createTextNote(selected.name.replace(/\.[^.]+$/, ''), content, `file-${selected.id}`); setSelected(null); onOpenNote(note.id) })} />}</View>}
        {!sourceNote && selected.purpose === 'meeting' && <Text style={styles.subtitle}>会议资料已保留。此文件当前可导出或删除；音频纪要从录音详情生成。</Text>}
        <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}><Text style={styles.label}>文件操作</Text><PrimaryButton secondary title="导出文件" loading={busy} onPress={() => void perform(() => exportLocalFile(selected))} /><PrimaryButton tertiary title="删除原始文件" disabled={busy} onPress={() => remove(selected)} /></View><AsyncState error={error} /></>}
    </BottomActionSheet>
  </View>
}
import { BilibiliSourceInfo } from '../components/BilibiliSourceInfo'
