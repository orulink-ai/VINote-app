import { Text } from './AppText'
import React, { createContext, useContext, useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { colors, styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'
import { WorkspaceIcon } from './WorkspaceIcon'

// Root supplies this only to top-level content pages; subpages retain Back.
export const MainAccountActionContext = createContext<(() => void) | undefined>(undefined)

export function ScreenHeader({ title, onBack, backLabel = '返回', right, titleLines = 1, disabled = false }: { title: string; onBack?: () => void; backLabel?: string; right?: React.ReactNode; titleLines?: number; disabled?: boolean }) {
  const onAccount = useContext(MainAccountActionContext)
  const reduced = useReducedMotion(), reveal = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduced) { reveal.setValue(1); return }
    reveal.setValue(0)
    const animation = Animated.timing(reveal, { toValue: 1, duration: 180, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true })
    animation.start(); return () => animation.stop()
  }, [title, reduced, reveal])
  return <View style={{ minHeight: 56, paddingHorizontal: onBack ? 12 : 20, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.canvas }}>
    {onBack && <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.primarySoft : 'transparent' })}><View style={{ width: 10, height: 10, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: colors.navigationAccent, transform: [{ rotate: '45deg' }] }} /></Pressable>}
    <Animated.View style={{ flex: 1, gap: 3, opacity: reveal, transform: [{ translateY: reduced ? 0 : reveal.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }] }}>
      <Text numberOfLines={titleLines} style={[styles.noteTitle, { fontSize: onBack ? 17 : 22, lineHeight: onBack ? 24 : 30, fontWeight: '500' }]}>{title}</Text>
    </Animated.View>{right}
    {!onBack && onAccount && <Pressable accessibilityRole="button" accessibilityLabel="账号与设置" onPress={onAccount} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.primarySoft : 'transparent' })}><WorkspaceIcon name="account" /></Pressable>}
  </View>
}
