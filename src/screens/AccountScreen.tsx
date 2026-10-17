import { Text } from '../components/AppText'
import React, { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { colors, styles } from '../design-system/theme'
import { ScreenHeader } from '../components/ScreenHeader'
import { BrandMark } from '../components/BrandMark'
import { readSession } from '../lib/storage'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ gap: 8 }}><Text accessibilityRole="header" style={[styles.label, { color: colors.muted, marginBottom: 0, paddingHorizontal: 4 }]}>{title}</Text><View style={[styles.card, { paddingVertical: 4, gap: 0 }]}>{children}</View></View>
}
function Row({ title, detail, onPress, expanded }: { title: string; detail?: string; onPress: () => void; expanded?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress} style={({ pressed }) => ({ minHeight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })}><View style={{ flex: 1, gap: 4 }}><Text style={styles.noteTitle}>{title}</Text>{!!detail && <Text style={styles.subtitle}>{detail}</Text>}</View><Text style={styles.subtitle}>{expanded ? '−' : '›'}</Text></Pressable>
}
export function AccountScreen({ onAppearance, onModels, onRecordings, onConnections, onTasks, onSignOut, onSettings, onBack }: {
  onAppearance: () => void; onModels: () => void; onRecordings: () => void; onConnections: () => void; onTasks: () => void; onSignOut: () => void
  onSettings?: () => void; onBack?: () => void
}) {
  const [email, setEmail] = useState('当前账号')
  useEffect(() => {
    let active = true
    void readSession().then(session => { if (active) setEmail(session?.user.email || '当前账号') }).catch(() => {})
    return () => { active = false }
  }, [])
  return <View style={styles.screen}>
    <ScreenHeader title="账号" onBack={onBack} backLabel="返回" />
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 22, paddingBottom: 24 }}>
      <Section title="账号"><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><BrandMark size={36} /><View style={{ flex: 1, gap: 4 }}><Text numberOfLines={2} style={styles.noteTitle}>{email}</Text><Text style={styles.subtitle}>个人工作空间</Text></View></View></Section>
      {onSettings ? <Section title="应用"><Row title="设置" detail="模型、外观、存储" onPress={onSettings} /></Section> : <>
      <Section title="内容处理"><Row title="转写与总结" detail="选择模型与服务，应用于下一次处理" onPress={onModels} /></Section>
      <Section title="数据"><Row title="处理记录" detail="核验任务与结果" onPress={onTasks} /><View style={{ height: 1, backgroundColor: colors.line }} /><Row title="录音库" detail="播放、导出与管理" onPress={onRecordings} /></Section>
      <Section title="连接与工具"><Row title="飞书与 MCP" detail="文档交付、连接和工具权限" onPress={onConnections} /></Section>
      <Section title="使用偏好"><Row title="外观" detail="浅色、深色或跟随系统" onPress={onAppearance} /></Section>
      </>}
      {onSettings && <Section title="历史与恢复"><Row title="处理历史" detail="核验原任务结果与恢复未完成操作" onPress={onTasks} /></Section>}
      <Pressable accessibilityRole="button" onPress={() => Alert.alert('退出当前账号？', '本机资料保留，桌面端登录不会受影响。', [{ text: '取消', style: 'cancel' }, { text: '退出', onPress: onSignOut }])} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 }}><Text style={{ color: colors.danger }}>退出登录</Text></Pressable>
    </ScrollView>
  </View>
}
