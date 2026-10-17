import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { Text } from './AppText'
import { colors, styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'
import type { RecordingPhase } from '../screens/RecordScreen'

export function RecordingMiniBar({ paused, seconds, saving, status, onExpand }: { paused: boolean; seconds: number; saving: boolean; status?: RecordingPhase; onExpand: () => void }) {
  const labels: Record<RecordingPhase, string> = { idle: '录音控制', preparing: '正在准备麦克风', cancelling: '正在取消准备', recording: '录音进行中', unconfirmed: '录音状态待确认', paused: '录音已暂停', pausing: '正在暂停录音', resuming: '正在继续录音', saving: '正在保存原录音', 'save-failed': '原录音保存未完成' }
  const label = status ? labels[status] : saving ? labels.saving : paused ? labels.paused : labels.recording
  const reduced = useReducedMotion(), reveal = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduced) { reveal.setValue(1); return }
    reveal.setValue(0)
    const animation = Animated.timing(reveal, { toValue: 1, duration: 240, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true })
    animation.start(); return () => animation.stop()
  }, [reduced, reveal])
  return <Animated.View style={{ opacity: reveal, transform: [{ translateY: reduced ? 0 : reveal.interpolate({ inputRange: [0, 1], outputRange: [9, 0] }) }], paddingHorizontal: 12, paddingBottom: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="展开录音控制" onPress={onExpand} style={({ pressed }) => ({ minHeight: 60, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, flexDirection: 'row', gap: 12, alignItems: 'center' })}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF18', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: paused ? 9 : 8, height: paused ? 9 : 8, borderRadius: paused ? 2 : 4, backgroundColor: saving ? colors.onPrimary : '#F2A29B' }} /></View>
      <View style={{ flex: 1, gap: 2 }}><Text style={{ fontSize: 13, lineHeight: 20, color: colors.onPrimary }}>{label}</Text><Text style={{ fontSize: 10, lineHeight: 15, color: colors.onPrimary, opacity: 0.7 }}>{status === 'save-failed' ? '点击展开，重试保存同一份录音' : status === 'preparing' || status === 'cancelling' ? '点击展开查看准备状态' : '点击展开控制 · 原录音留在此设备'}</Text></View>
      <Text style={[styles.noteBody, { color: colors.onPrimary, fontVariant: ['tabular-nums'] }]}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text><Text style={{ color: colors.onPrimary }}>⌃</Text>
    </Pressable>
  </Animated.View>
}
