import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { Text } from '../components/AppText'
import { colors, styles } from '../design-system/theme'
import { AndroidUpdateInstall } from '../components/AndroidUpdateInstall'

export function SettingsScreen({ onBack, onAppearance, onModels, onData, onConnections }: { onBack: () => void; onAppearance: () => void; onModels: () => void; onData: () => void; onConnections: () => void }) {
  return <View style={styles.screen}><ScreenHeader title="设置" onBack={onBack} backLabel="返回账号" /><ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <View style={[styles.card, { gap: 0, paddingVertical: 2 }]}>{[
      { title: '外观', detail: '显示主题；字体大小与减少动效跟随系统', action: onAppearance },
      { title: '转写与总结', detail: '选择模型，默认用于下一次处理', action: onModels },
      { title: '存储', detail: '文件目录、占用与回收站', action: onData },
      { title: '飞书', detail: '账号连接、文档位置和通知对象', action: onConnections },
    ].map((row, index) => <Pressable key={row.title} accessibilityRole="button" accessibilityLabel={row.title} onPress={row.action} style={({ pressed }) => ({ minHeight: 68, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1, borderTopWidth: index ? 1 : 0, borderColor: colors.line })}><View style={{ flex: 1, gap: 4 }}><Text style={styles.noteTitle}>{row.title}</Text><Text style={styles.subtitle}>{row.detail}</Text></View><Text style={[styles.subtitle, { fontSize: 20 }]}>›</Text></Pressable>)}</View>
    <AndroidUpdateInstall />
    <View style={[styles.card, { gap: 10 }]}><Text accessibilityRole="header" style={styles.noteTitle}>录制与隐私</Text><Text style={styles.subtitle}>录音先保存在此设备。选择生成纪要后，音频才会提交给选定的转写服务。</Text></View>
  </ScrollView></View>
}
