import React from 'react'
import { Pressable } from 'react-native'
import { Text } from './AppText'
import { useRecordingProgress } from '../features/recording/useRecordingProgress'
import { colors, styles } from '../design-system/theme'
export function GlobalTaskStatus({ onPress }: { onPress: () => void }) {
  const progress = useRecordingProgress()
  if (!progress?.text) return null
  return <Pressable accessibilityRole="button" accessibilityLabel={`处理状态：${progress.text}`} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', backgroundColor: pressed ? colors.primarySoft : colors.canvas })}><Text numberOfLines={1} accessibilityLiveRegion="polite" style={styles.subtitle}>处理中 · {progress.text} ›</Text></Pressable>
}
