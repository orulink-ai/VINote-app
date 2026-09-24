import React from 'react'
import { ScrollView, Text, Pressable } from 'react-native'
import { Card, YStack, XStack } from 'tamagui'
import { PrimaryButton } from '../components/PrimaryButton'
import { colors, styles } from '../design-system/theme'

export function HomeScreen({ onRecord, onRecordings, onNotes, onSignOut }: { onRecord: () => void; onRecordings: () => void; onNotes: () => void; onSignOut: () => void }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <XStack justifyContent="space-between" alignItems="center">
      <Text style={styles.noteTitle}>VINote</Text>
      <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={12}><Text style={styles.subtitle}>退出登录</Text></Pressable>
    </XStack>
    <YStack paddingVertical={24} gap={10}>
      <Text style={styles.subtitle}>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</Text>
      <Text style={[styles.title, { fontSize: 32, lineHeight: 43 }]}>记录。回听。整理。</Text>
      <Text style={styles.subtitle}>从一段录音，到清晰可回顾的会议纪要。</Text>
    </YStack>
    <Card backgroundColor={colors.primary} borderRadius={12} padding={24} gap={20}>
      <Text style={{ color: '#BFE5D7', fontSize: 13, letterSpacing: 2 }}>会议录音</Text>
      <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '600' }}>新建会议录音</Text>
      <Text style={{ color: '#DCEEE7', fontSize: 15, lineHeight: 23 }}>仅保存原始音频，或结束后生成会议纪要。</Text>
      <PrimaryButton secondary title="开始录音" onPress={onRecord} />
    </Card>
    <Card backgroundColor="white" borderRadius={12} padding={22} gap={12} borderWidth={1} borderColor={colors.line}>
      <Text style={styles.noteTitle}>我的会议纪要</Text>
      <Text style={styles.subtitle}>回顾讨论内容、会议结论与后续行动。</Text>
      <PrimaryButton secondary title="查看会议纪要" onPress={onNotes} />
    </Card>
    <PrimaryButton secondary title="录音库 / 原始音频" onPress={onRecordings} />
    <Text style={[styles.subtitle, { textAlign: 'center', paddingVertical: 16 }]}>录制 → 云端转写 → 生成纪要</Text>
  </ScrollView>
}
