import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../components/AppText'
import { ScreenHeader } from '../components/ScreenHeader'
import { colors, styles, getAppearanceMode, setAppearanceMode, type AppearanceMode } from '../design-system/theme'

export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState(getAppearanceMode())
  const [busy, setBusy] = useState(false)
  return <View style={styles.screen}>
    <ScreenHeader title="外观" onBack={onBack} backLabel="返回设置" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.label}>显示主题</Text>
      <View style={styles.card}>{(['system', 'light', 'dark'] as AppearanceMode[]).map(value =>
        <Pressable key={value} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: mode === value, disabled: busy }} onPress={async () => {
          setBusy(true)
          try { await setAppearanceMode(value); setMode(value) } catch (cause) { Alert.alert('设置未保存', (cause as Error).message) } finally { setBusy(false) }
        }} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, paddingHorizontal: 12, backgroundColor: mode === value ? colors.primarySoft : colors.card }}>
          <Text style={styles.noteTitle}>{{ system: '跟随系统', light: '浅色', dark: '深色' }[value]}</Text><Text style={styles.subtitle}>{mode === value ? '已选择' : ''}</Text>
        </Pressable>)}</View>
      <Text style={styles.subtitle}>主题仅作用于当前设备；字体大小与减少动效跟随系统设置。</Text>
    </ScrollView>
  </View>
}
