import React from 'react'
import { ScrollView, Text, Pressable, View } from 'react-native'
import { colors, styles } from '../design-system/theme'

function HomeAction({ eyebrow, title, description, onPress }: { eyebrow: string; title: string; description: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [styles.card, { minHeight: 136, justifyContent: 'space-between', backgroundColor: pressed ? colors.primarySoft : colors.card }]}>
    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1 }}>{eyebrow}</Text>
    <View style={{ gap: 5 }}>
      <Text style={[styles.noteTitle, { fontSize: 20 }]}>{title}  ↗</Text>
      <Text style={styles.subtitle}>{description}</Text>
    </View>
  </Pressable>
}

export function HomeScreen({ onRecord, onRecordings, onNotes, onSignOut }: { onRecord: () => void; onRecordings: () => void; onNotes: () => void; onSignOut: () => void }) {
  return <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 40 }]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={[styles.noteTitle, { fontSize: 21, letterSpacing: -0.6 }]}>VINote</Text>
      <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={12} style={{ padding: 8 }}><Text style={styles.subtitle}>退出</Text></Pressable>
    </View>
    <View style={{ paddingTop: 66, paddingBottom: 44, gap: 12 }}>
      <Text style={styles.subtitle}>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</Text>
      <Text style={[styles.title, { fontSize: 34, lineHeight: 44 }]}>今天记录什么？</Text>
      <Text style={styles.subtitle}>录制会议，保存原声，再整理成清晰的纪要。</Text>
    </View>
    <HomeAction eyebrow="01 / CAPTURE" title="开始会议录音" description="录制并保存原始音频" onPress={onRecord} />
    <HomeAction eyebrow="02 / LIBRARY" title="录音库" description="回听、导出或生成会议纪要" onPress={onRecordings} />
    <HomeAction eyebrow="03 / NOTES" title="会议纪要" description="搜索和阅读已生成的内容" onPress={onNotes} />
    <Text style={[styles.subtitle, { textAlign: 'center', fontSize: 13, paddingTop: 12 }]}>录制  ·  回听  ·  整理</Text>
  </ScrollView>
}
