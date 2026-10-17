import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { AsyncState } from './AsyncState'
import { MeetingMarkdown } from './MeetingMarkdown'
import { BottomActionSheet } from './BottomActionSheet'
import { listLocalNotes, noteRevisions, editNoteContent } from '../lib/notes'
import { readWorkspace, type WorkspaceVersion } from '../lib/workspaceStorage'
import { readAccountId } from '../lib/storage'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { styles } from '../design-system/theme'
import type { Note } from '../types/api'
import { versionRecordLabel, versionRecordTime } from '../lib/versionRecordLabel'
type HistoryEntry = WorkspaceVersion & { recordKey: string }

export function NoteVersionsPanel({ note, visible, onClose, onUpdated, onGenerate }: { note: Note; visible: boolean; onClose: () => void; onUpdated: (note: Note) => void; onGenerate?: () => void }) {
  const owner = useRef('')
  const readSequence = useRef(0)
  const [versions, setVersions] = useState<HistoryEntry[]>([]), [selected, setSelected] = useState<HistoryEntry | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [compare, setCompare] = useState(false)
  const [evidence, setEvidence] = useState<string | null>(null)
  const load = async () => {
    const run = ++readSequence.current, epoch = identityEpoch()
    const current = () => run === readSequence.current && identityEpoch() === epoch
    const guard = () => { if (!current()) throw new Error('历史来源或账号已变化，请重新查看') }
    setBusy(true); setError('')
    try {
      const account = await readAccountId()
      guard()
      if (!account) throw new Error('请重新登录')
      if (owner.current && owner.current !== account) throw new Error('账号已切换')
      owner.current = account
      const state = await readWorkspace(account)
      guard()
      const key = note.workspace_key || Object.values(state.mappings).find(map => map.localIds.includes(note.id))?.key
      const all: HistoryEntry[] = key ? (state.cache[key]?.versions || []).map((item, index) => ({ ...item, recordKey: `workspace:${key}:${item.id}:${index}` })) : []
      const rows = await listLocalNotes(account)
      guard()
      for (const row of rows.filter(row => row.id === note.id || (!!note.task_id && row.task_id === note.task_id) || (!!note.content_id && row.content_id === note.content_id) || (!!note.workspace_key && row.workspace_key === note.workspace_key))) {
        all.push({ id: row.id, recordKey: `note:${row.id}`, title: `${Number.isSafeInteger(row.version) && row.version! > 0 ? `已保存版本 ${row.version}` : '已保存正文'} · ${row.title}`, content: row.content, created_at: row.updated_at })
        const revisions = await noteRevisions(row.id)
        guard()
        for (const [index, revision] of revisions.entries()) all.push({ id: `${row.id}-edit-${index}`, recordKey: `edit:${row.id}:${index}`, title: `正文编辑 · ${row.title}`, content: revision.content, created_at: revision.savedAt, kind: 'edit' })
      }
      if (await readAccountId() !== account) throw new Error('账号已切换')
      guard()
      setVersions(all.sort((a, b) => b.created_at.localeCompare(a.created_at)))
    } catch (cause) { if (current()) setError((cause as Error).message) }
    finally { if (current()) setBusy(false) }
  }
  useEffect(() => {
    owner.current = ''; setVersions([]); setSelected(null); setEvidence(null); setCompare(false)
    if (visible) void load()
    return () => { readSequence.current++ }
  }, [visible, note.id, note.task_id, note.content_id, note.workspace_key])
  useEffect(() => subscribeIdentity(() => {
    readSequence.current++; owner.current = ''; setVersions([]); setSelected(null); setEvidence(null); setBusy(false)
    setError('账号已变化，请返回原内容后重新查看历史')
  }), [])
  const restore = async () => {
    if (!selected || busy) return
    const epoch = identityEpoch(), run = readSequence.current
    const current = () => epoch === identityEpoch() && run === readSequence.current
    setBusy(true); setError('')
    try {
      if (await readAccountId() !== owner.current || !current()) throw new Error('账号或历史来源已变化')
      const updated = await editNoteContent(note.id, selected.content, note, owner.current)
      if (current()) { onUpdated(updated); onClose() }
    }
    catch (cause) { if (current()) setError((cause as Error).message) }
    finally { if (current()) setBusy(false) }
  }
  return <BottomActionSheet visible={visible} title="版本与历史" onClose={() => { if (!busy) onClose() }}>
    <AsyncState loading={busy} error={error} onRetry={() => void load()} />
    <Text style={styles.subtitle}>查看不改变默认正文；恢复会保存新编辑修订，保留后续历史。已保存版本均可阅读。</Text>
    {onGenerate && !selected && <><Text style={styles.subtitle}>生成使用当前已保存正文与文字证据；原始文件和现有版本保留。</Text><PrimaryButton secondary title="生成新版本" disabled={busy} onPress={onGenerate} /></>}
    {selected ? <>
      <Text style={styles.noteTitle}>{selected.title}</Text><Text style={styles.subtitle}>{versionRecordLabel(selected.kind)} · {versionRecordTime(selected.created_at)} {selected.model || ''}</Text>
      <Text style={styles.subtitle}>{selected.evidence_revision ? `原文快照修订 ${selected.evidence_revision}` : '此历史版本未保存原文快照；详情逐字稿为当前证据，不代表旧输入。'}</Text>
      {!!selected.evidence_revision && <Text style={styles.subtitle}>旧版本记录保留原文引用；未保存到设备的原文不再自动读取。</Text>}
      {evidence !== null && <Text selectable style={styles.noteBody}>{evidence}</Text>}
      <PrimaryButton secondary title={compare ? '结束比较' : '与当前正文按段比较'} onPress={() => setCompare(!compare)} />
      {compare ? <View style={{ gap: 14 }}>{Array.from({ length: Math.max(selected.content.split(/\n\n+/).length, note.content.split(/\n\n+/).length) }, (_, index) => {
        const before = selected.content.split(/\n\n+/)[index] || '', after = note.content.split(/\n\n+/)[index] || ''
        return before === after ? null : <View key={index} style={styles.card}><Text style={styles.label}>第 {index + 1} 段 · 所选版本</Text><Text selectable style={styles.noteBody}>{before || '（空）'}</Text><Text style={styles.label}>当前正文</Text><Text selectable style={styles.noteBody}>{after || '（空）'}</Text></View>
      })}{selected.content === note.content && <Text style={styles.subtitle}>正文一致</Text>}</View> : <MeetingMarkdown content={selected.content} />}
      <PrimaryButton title="恢复为新的编辑修订" disabled={busy || selected.content === note.content} onPress={() => void restore()} />
      <PrimaryButton secondary title="返回全部版本" onPress={() => { setSelected(null); setEvidence(null) }} />
    </> : versions.map(item => <PrimaryButton key={item.recordKey} secondary title={`${item.title} · ${versionRecordLabel(item.kind)} · ${versionRecordTime(item.created_at)}`} onPress={() => { setSelected(item); setEvidence(null) }} />)}
    {!busy && !error && !versions.length && <Text style={styles.subtitle}>尚无历史修订；保存编辑后会保留旧正文。</Text>}
  </BottomActionSheet>
}
