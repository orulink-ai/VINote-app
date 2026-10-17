import React from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from './AppText'
import { WorkspaceIcon } from './WorkspaceIcon'
import { colors, styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'

export function ContentIntake({ onImport }: { onImport: (mode?: 'url' | 'file') => void }) {
  const { width, fontScale } = useWindowDimensions()
  const stacked = width < 360 || fontScale > 1.25
  const reduced = useReducedMotion()
  return <View style={{ flexDirection: stacked ? 'column' : 'row', gap: 10 }}>
    {([
      { mode: 'url', title: '粘贴链接', description: 'B 站 · 网页 · 公开文档', hint: '生成总结笔记，也支持其他公开视频链接', icon: 'link' },
      { mode: 'file', title: '导入文件', description: 'PDF · Word · 音视频', hint: '生成总结笔记，也支持文字和字幕文件', icon: 'content' },
    ] as const).map(item => <Pressable key={item.mode} accessibilityRole="button" accessibilityLabel={`${item.title}，${item.description}`} accessibilityHint={item.hint} onPress={() => onImport(item.mode)} style={({ pressed }) => ({ flex: stacked ? undefined : 1, minWidth: 0, minHeight: 80, padding: 12, borderWidth: 1, borderRadius: 14, borderColor: colors.line, gap: 6, justifyContent: 'center', backgroundColor: pressed ? colors.primarySoft : colors.card, transform: [{ scale: pressed && !reduced ? 0.985 : 1 }] })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><WorkspaceIcon name={item.icon} /><Text style={[styles.noteTitle, { flex: 1 }]}>{item.title}</Text></View>
      <Text style={[styles.subtitle, { fontSize: 12 }]}>{item.description}</Text>
    </Pressable>)}
  </View>
}
