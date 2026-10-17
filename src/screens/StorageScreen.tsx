import React, { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import FS from 'react-native-fs'
import { Text } from '../components/AppText'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { AsyncState } from '../components/AsyncState'
import { styles } from '../design-system/theme'
import { listDeletedNotes, setNoteDeleted } from '../lib/notes'
import { subscribeWorkspace } from '../lib/workspaceStorage'
import { readAccountId, sessionRevision } from '../lib/storage'
import type { Note } from '../types/api'

export function StorageScreen({ onBack, onFiles, onOpen }: { onBack: () => void; onFiles: () => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Note[]>([]), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [space, setSpace] = useState(''), owner = useRef(''), mounted = useRef(true), sequence = useRef(0)
  const load = async () => {
    const epoch = ++sequence.current, generation = sessionRevision(), account = await readAccountId()
    if (!account) throw new Error('请登录后查看资料')
    const deleted = await listDeletedNotes(account)
    const valid = async () => mounted.current && epoch === sequence.current && sessionRevision() === generation && await readAccountId() === account
    if (!await valid()) return
    owner.current = account; setRows(deleted); setReady(true); setError('')
    try { const info = await FS.getFSInfo(); if (await valid()) setSpace(`设备可用 ${(info.freeSpace / 1073741824).toFixed(1)} GB`) } catch { /* File access remains available even if disk statistics fail. */ }
  }
  useEffect(() => {
    mounted.current = true
    const update = () => { void load().catch(cause => { if (mounted.current) setError(cause.message) }) }
    update(); const remove = subscribeWorkspace(update)
    return () => { mounted.current = false; sequence.current++; remove() }
  }, [])
  return <View style={styles.screen}><ScreenHeader title="存储" onBack={onBack} backLabel="返回设置" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>文件与目录</Text>
      <Text selectable style={styles.subtitle}>{FS.DocumentDirectoryPath}</Text>
      {!!space && <Text style={styles.subtitle}>{space}</Text>}
      <PrimaryButton secondary title="查看文件" onPress={onFiles} />
      <Text style={styles.sectionTitle}>回收站</Text>
      <Text style={styles.subtitle}>删除的正文和历史可恢复；原文件与已发布文档独立保留。</Text>
      <AsyncState loading={!ready && !error} error={error} onRetry={() => void load().catch(cause => setError(cause.message))} retryLabel="重新读取" />
      {ready && !rows.length && <Text style={styles.subtitle}>回收站为空</Text>}
      {rows.map(note => <View key={note.id} style={styles.listRow}><Text style={styles.noteTitle}>{note.title}</Text><PrimaryButton secondary title="恢复" disabled={busy} onPress={async () => {
        if (busy) return
        setBusy(true); setError('')
        try { await setNoteDeleted(note.id, false, owner.current); await load(); if (mounted.current && await readAccountId() === owner.current) onOpen(note.id) }
        catch (cause) { if (mounted.current) setError((cause as Error).message) }
        finally { if (mounted.current) setBusy(false) }
      }} /></View>)}
    </ScrollView>
  </View>
}
