import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, Pressable, View } from 'react-native'
import { Text } from '../components/AppText'
import { ScreenHeader } from '../components/ScreenHeader'
import { AsyncState } from '../components/AsyncState'
import { PrimaryButton } from '../components/PrimaryButton'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { colors, styles } from '../design-system/theme'
import { listNotes } from '../lib/notes'
import { subscribeWorkspace } from '../lib/workspace'
import type { Note } from '../types/api'

export function ProjectsScreen({ onSelect, onContent }: { onSelect: (project: string) => void; onContent: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const epoch = useRef(0)
  const load = useCallback(async () => {
    const current = ++epoch.current; setLoading(true); setError('')
    try { const result = await listNotes(); if (current === epoch.current) setNotes(result) }
    catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : '项目加载失败') }
    finally { if (current === epoch.current) setLoading(false) }
  }, [])
  useEffect(() => { void load(); const unsubscribe = subscribeWorkspace(() => void load()); return () => { ++epoch.current; unsubscribe() } }, [load])
  const projects = [...new Set(notes.filter(n => !n.archived).map(n => n.project).filter((p): p is string => !!p))].sort()
  return <View style={styles.screen}><ScreenHeader title="项目" /><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.subtitle}>按项目查看同一份内容。项目与标签在内容详情中管理。</Text>
    <AsyncState loading={loading && !notes.length} error={error} retryLabel="重新加载项目" onRetry={() => void load()} />
    {projects.map(project => <Pressable key={project} accessibilityRole="button" accessibilityLabel={`项目 ${project}`} onPress={() => onSelect(project)} style={({ pressed }) => [styles.listRow, { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 88, backgroundColor: pressed ? colors.primarySoft : colors.card }]}>
      <WorkspaceIcon name="folder" /><View style={{ flex: 1, gap: 8 }}><Text style={styles.noteTitle}>{project}</Text><Text style={styles.subtitle}>{notes.filter(n => !n.archived && n.project === project).length} 份内容</Text></View><WorkspaceIcon name="chevron" muted />
    </Pressable>)}
    {!loading && !error && !projects.length && <View style={styles.emptyState}><Text style={styles.noteTitle}>还没有项目</Text><Text style={styles.subtitle}>在内容详情设置项目后，这里会显示对应内容。</Text><PrimaryButton secondary title="选择内容" onPress={onContent} /></View>}
  </ScrollView></View>
}
