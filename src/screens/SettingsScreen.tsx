import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { Text } from '../components/AppText'
import { colors, styles } from '../design-system/theme'

export function SettingsScreen({ onBack, onAppearance, onModels, onData, onConnections }: { onBack: () => void; onAppearance: () => void; onModels: () => void; onData: () => void; onConnections: () => void }) {
  return <View style={styles.screen}><ScreenHeader title="设置" onBack={onBack} backLabel="返回账号" /><ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    {[
      { title: '外观', detail: '显示主题；字体大小与减少动效跟随系统', action: onAppearance },
      { title: '转写与总结', detail: '选择模型，默认用于下一次处理', action: onModels },
      { title: '存储', detail: '文件目录、占用与回收站', action: onData },
      { title: '授权与插件', detail: '前往同一插件配置，不重复维护授权', action: onConnections },
    ].map(row => <Pressable key={row.title} accessibilityRole="button" accessibilityLabel={row.title} onPress={row.action} style={({ pressed }) => [styles.card, { minHeight: 72, opacity: pressed ? 0.7 : 1, gap: 6 }]}><Text style={styles.noteTitle}>{row.title}</Text><Text style={styles.subtitle}>{row.detail}</Text></Pressable>)}
    <View style={[styles.card, { gap: 10 }]}><Text accessibilityRole="header" style={styles.noteTitle}>录制与隐私</Text><Text style={styles.subtitle}>App 使用系统录音权限。录制结束先保存完整文件，再选择生成。开启生成会把音频提交给选定的转写服务；原文件与正文分别管理。</Text><Text style={[styles.subtitle, { color: colors.ink }]}>授权和外部工具访问范围在插件中逐项管理。</Text></View>
  </ScrollView></View>
}
