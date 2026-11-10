import React from 'react'
import { View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { styles } from '../design-system/theme'
import { savedNoteForClientTask, type ClientNoteHistoryItem } from '../lib/clientNoteHistoryList'

const labels: Record<ClientNoteHistoryItem['status'], string> = {
  pending: '等待处理', running: '处理中', failed: '处理未完成', unknown: '结果待确认', success: '已完成', unavailable: '暂时无法读取',
}

export function ClientNoteHistorySection({ items, notes, onOpen }: {
  items: ClientNoteHistoryItem[]
  notes: Array<{ id: string; task_id?: string | null; deleted?: boolean }>
  onOpen: (item: ClientNoteHistoryItem, noteId: string) => void
}) {
  return <View style={{ gap: 10 }}>
    <Text style={styles.sectionTitle}>笔记任务</Text>
    {!items.length && <Text style={styles.subtitle}>暂无笔记任务记录</Text>}
    {items.map(item => {
      const noteId = savedNoteForClientTask(item, notes)
      const time = new Date(item.submittedAt)
      const submitted = Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { hour12: false }) : ''
      return <View key={item.operationId} style={[styles.card, { gap: 8 }]}>
        <Text style={styles.noteTitle}>{item.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{labels[item.status]} · {item.message}</Text>
        {!!submitted && <Text style={styles.subtitle}>提交于 {submitted}</Text>}
        {!!noteId && <PrimaryButton secondary title="打开笔记" onPress={() => onOpen(item, noteId)} />}
      </View>
    })}
  </View>
}
