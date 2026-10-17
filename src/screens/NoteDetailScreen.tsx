import { Text } from '../components/AppText'
import { BilibiliSourceInfo } from '../components/BilibiliSourceInfo'
import { DetailDisclosure } from '../components/DetailDisclosure'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { MeetingDetailWorkspace } from '../components/MeetingDetailWorkspace'
import { NoteVersionsPanel } from '../components/NoteVersionsPanel'
import { GenerateVersionPanel } from '../components/GenerateVersionPanel'
import { ScreenHeader } from '../components/ScreenHeader'
import { BottomActionSheet } from '../components/BottomActionSheet'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { RenameForm } from '../components/RenameDialog'
import { colors, styles } from '../design-system/theme'
import { archiveNote, classifyNote, getNote, renameNote, shareNoteFile, exportNoteFile, deleteNote } from '../lib/notes'
import { subscribeWorkspace } from '../lib/workspaceStorage'
import { Field } from '../components/Field'
import { AsyncState } from '../components/AsyncState'
import type { Note } from '../types/api'
import { devReadTiming as startRead } from '../lib/storage'

import { type FeishuDeliveryReturn } from '../lib/feishuDeliveryReturn'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'

const devReadTiming: typeof startRead = startRead ?? (() => () => {})

export function NoteDetailScreen({
  id,
  onBack,
  onSettings,
  deliveryReturn,
  onDeliveryReturnConsumed,
  onRecording,
  onTools,
  onContentPlugins,
  onSourceFiles,
  initialTab,
  backLabel = '纪要列表',
}: {
  id: string
  onBack: () => void
  onSettings?: (resume?: FeishuDeliveryReturn) => void
  deliveryReturn?: FeishuDeliveryReturn
  onDeliveryReturnConsumed?: () => void
  onRecording?: (recordingId: string) => void
  onTools?: (note: Note) => void
  onContentPlugins?: (note: Note) => void
  onSourceFiles?: (note: Note) => void
  backLabel?: string
  initialTab?: '纪要' | '对话'
}) {
  const [sessionEpoch, setSessionEpoch] = useState(identityEpoch)
  useEffect(() => subscribeIdentity(() => setSessionEpoch(identityEpoch())), [])
  const [note, setNote] = useState<Note | null>(null)
  const refreshEpoch = useRef(0)
  const readCommit = useRef<ReturnType<typeof devReadTiming> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const deleteLock = useRef(false)
  const [classifying, setClassifying] = useState(false)
  const [project, setProject] = useState(''), [tags, setTags] = useState(''), [actionError, setActionError] = useState('')
  const contentLabel = (note?.source_type || '').startsWith('meeting') ? '纪要' : '笔记'
  // React commit only, not proof of native paint or readiness for interaction.
  useLayoutEffect(() => {
    if (!loading && note) { readCommit.current?.(); readCommit.current = null }
  }, [loading, note])
  useEffect(() => {
    let active = true
    const epoch = identityEpoch()
    const read = devReadTiming('detail.read')
    const commit = devReadTiming('detail.commit')
    readCommit.current = commit
    setLoading(true)
    setError('')
    setNote(null)
    getNote(id, { mode: 'display' })
      .then(value => {
        read(active ? 'ok' : 'discarded')
        if (active && epoch === identityEpoch()) {
          if (value.id !== id) throw new Error('内容身份未确认，请重新打开已保存内容')
          setNote(value)
        }
      })
      .catch(e => {
        read(active ? 'failed' : 'discarded')
        commit(active ? 'failed' : 'discarded')
        if (active)
          setError(e instanceof Error ? e.message : '加载失败，请重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      read('discarded')
      commit('discarded')
      if (readCommit.current === commit) readCommit.current = null
      active = false
    }
  }, [id, attempt, sessionEpoch])
  useEffect(() => {
    let active = true
    const unsubscribe = subscribeWorkspace(() => {
      const epoch = ++refreshEpoch.current
      const read = devReadTiming('detail.refresh')
      void getNote(id, { mode: 'display' }).then(next => {
        read(active && epoch === refreshEpoch.current ? 'ok' : 'discarded')
        if (active && epoch === refreshEpoch.current) setNote(previous => previous && (previous.workspace_revision !== next.workspace_revision || previous.content !== next.content || previous.title !== next.title || previous.archived !== next.archived) ? next : previous)
      }).catch(cause => { read(active && epoch === refreshEpoch.current ? 'failed' : 'discarded'); if (active && epoch === refreshEpoch.current) setActionError(`内容更新未确认，当前缓存保留：${cause.message}`) })
    })
    return () => { active = false; ++refreshEpoch.current; unsubscribe() }
  }, [id])
  const openActions = async () => { setActionError(''); setActionsOpen(true) }
  const confirmDelete = () => {
    if (!note || deleteLock.current) return
    const currentId = note.id
    Alert.alert(
      `将《${note?.title}》移入回收站？`,
      '正文与历史版本移入回收站，可从设置 → 存储恢复。原始文件与已发布飞书文档保留。',
      [
        { text: `保留${contentLabel}`, style: 'cancel' },
        {
          text: '移入回收站',
          style: 'destructive',
          onPress: async () => {
            if (deleteLock.current) return
            deleteLock.current = true
            setDeleting(true)
            setActionError('')
            try {
              await deleteNote(currentId)
              onBack()
            } catch (e) {
              setActionError(`删除未确认，内容保留：${e instanceof Error ? e.message : '请稍后重试'}`)
              setActionsOpen(true)
              Alert.alert(
                '删除未确认',
                e instanceof Error ? e.message : '请稍后重试',
              )
            } finally { deleteLock.current = false; setDeleting(false) }
          },
        },
      ],
    )
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader title={note?.title || '内容详情'} titleLines={2} onBack={onBack} backLabel={`返回${backLabel}`} disabled={deleting} right={note && <Pressable accessibilityRole="button" accessibilityLabel="内容操作" disabled={deleting} onPress={() => { void openActions() }} style={[styles.textButton, { minWidth: 44, flexDirection: 'row', gap: 4 }]}><WorkspaceIcon name="more" /><Text>操作</Text></Pressable>} />
      {!loading && note?.bilibili_source && <View style={{ paddingHorizontal: 20 }}><DetailDisclosure title="来源链接与分P"><BilibiliSourceInfo source={note.bilibili_source} /></DetailDisclosure></View>}
      {loading ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.subtitle}>正在加载内容…</Text>
          </View>
        </ScrollView>
      ) : error ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.emptyState}>
            <Text accessibilityRole="alert" style={styles.noteBody}>
              {error}
            </Text>
            <PrimaryButton
              title="重新加载"
              onPress={() => setAttempt(value => value + 1)}
            />
          </View>
        </ScrollView>
      ) : note ? (
        <MeetingDetailWorkspace
          key={note.id}
          note={note}
          initialTab={initialTab}
          onUpdated={setNote}
          onSettings={onSettings}
          deliveryReturn={deliveryReturn}
          onDeliveryReturnConsumed={onDeliveryReturnConsumed}
          onDelete={confirmDelete}
          onExport={() => void exportNoteFile(note).catch(cause => setActionError(cause.message))}
          onShare={() => void shareNoteFile(note).catch(cause => setActionError(cause.message))}
          header={
            <>
              {!!note.project && <Text style={styles.subtitle}>项目 · {note.project}</Text>}
              {!!note.tags?.length && <Text style={styles.subtitle}>{note.tags.map(tag => `#${tag}`).join('  ')}</Text>}
            </>
          }
        />
      ) : null}
      <BottomActionSheet
        onBack={renaming || classifying ? () => { if (!renameBusy) { setRenaming(false); setClassifying(false) } } : undefined}
        visible={actionsOpen}
        title={renaming ? '修改名称' : classifying ? '项目与标签' : '内容操作'}
        onClose={() => {
          if (!sharing && !deleting && !renameBusy) {
            setRenaming(false)
            setClassifying(false)
            setActionsOpen(false)
          }
        }}
      >
        {classifying && note ? <>
          <Field label="项目" value={project} onChangeText={setProject} maxLength={120} editable={!renameBusy} />
          <Field label="标签（逗号分隔）" value={tags} onChangeText={setTags} editable={!renameBusy} />
          <AsyncState error={actionError} />
          <PrimaryButton title="保存分类" loading={renameBusy} onPress={async () => { setRenameBusy(true); setActionError(''); try { setNote(await classifyNote(note.id, project, tags.split(/[,，]/))); setClassifying(false) } catch (cause) { setActionError((cause as Error).message) } finally { setRenameBusy(false) } }} />
          <PrimaryButton secondary title="返回操作" disabled={renameBusy} onPress={() => setClassifying(false)} />
        </> : renaming && note ? <RenameForm
          title={note.title}
          onBusyChange={setRenameBusy}
          onClose={() => setRenaming(false)}
          onSave={async title => {
            setNote(await renameNote(note.id, title))
          }}
        /> : <>
        <Text style={styles.label}>版本与来源</Text>
        {note && <PrimaryButton tertiary title="版本与历史" disabled={sharing || deleting} onPress={() => { setActionsOpen(false); setVersionsOpen(true) }} />}
        {note && !note.source_type?.startsWith('meeting') && onSourceFiles && <PrimaryButton tertiary title="查看来源文件" disabled={sharing || deleting} onPress={() => { setActionsOpen(false); onSourceFiles(note) }} />}
        {note?.source_type?.startsWith('meeting') && note.task_id && onRecording && <PrimaryButton tertiary title="查看原始录制" disabled={sharing || deleting} onPress={() => { setActionsOpen(false); onRecording(note.task_id!) }} />}
        {note && (onTools || onContentPlugins) && <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14 }}><Text style={styles.label}>内容工具</Text><Text style={styles.subtitle}>核对处理结果后另存版本，保留当前正文。</Text></View>}
        {note && onTools && <PrimaryButton tertiary title="全文翻译 · MCP 工具" disabled={sharing || deleting} onPress={() => { setActionsOpen(false); onTools(note) }} />}
        {note && onContentPlugins && <PrimaryButton tertiary title="流程图历史记录" disabled={sharing || deleting} onPress={() => { setActionsOpen(false); onContentPlugins(note) }} />}
        <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14 }}><Text style={styles.label}>分类与管理</Text></View>
        <PrimaryButton tertiary title="项目与标签" disabled={sharing || deleting} onPress={() => { setProject(note?.project || ''); setTags(note?.tags?.join('，') || ''); setActionError(''); setClassifying(true) }} />
        <PrimaryButton tertiary title={note?.archived ? '移出归档' : '归档内容'} disabled={sharing || deleting} onPress={async () => { if (!note) return; setSharing(true); try { setNote(await archiveNote(note.id, !note.archived)); setActionsOpen(false) } catch (cause) { setActionError((cause as Error).message) } finally { setSharing(false) } }} />
        <AsyncState error={actionError} />
        <PrimaryButton
          tertiary
          title="修改名称"
          disabled={sharing || deleting}
          onPress={() => {
            setRenaming(true)
          }}
        />
        <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14 }}><Text style={styles.label}>导出与分享</Text></View>
        <PrimaryButton
          tertiary
          title={`分享${contentLabel}文件`}
          loading={sharing}
          disabled={deleting}
          onPress={async () => {
            setSharing(true)
            try {
              if (note) await shareNoteFile(note)
            } catch (e) {
              Alert.alert(
                '分享失败',
                e instanceof Error ? e.message : '请稍后重试',
              )
            } finally {
              setSharing(false)
            }
          }}
        />
        <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14 }}><Text style={styles.label}>删除内容</Text></View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="移入回收站"
          disabled={sharing || deleting || !note}
          onPress={() => {
            setActionsOpen(false)
            confirmDelete()
          }}
          style={{ minHeight: 48, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.danger }}>
            {deleting ? '正在移入…' : '移入回收站'}
          </Text>
        </Pressable>
        <Text style={styles.subtitle}>回收站保留正文与历史，原文件和已发布文档不受影响。</Text>
        </>}
      </BottomActionSheet>
      {note && <NoteVersionsPanel note={note} visible={versionsOpen} onClose={() => setVersionsOpen(false)} onUpdated={setNote} onGenerate={() => { setVersionsOpen(false); setGenerateOpen(true) }} />}
      <BottomActionSheet visible={generateOpen} title="基于文字生成新版本" onClose={() => setGenerateOpen(false)}>
        {generateOpen && note && <GenerateVersionPanel note={note} onUpdated={next => { setNote(next); setGenerateOpen(false) }} />}
      </BottomActionSheet>
    </View>
  )
}
