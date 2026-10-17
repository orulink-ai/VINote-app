import { Text } from './AppText'
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { colors } from '../design-system/theme'
import { WorkspaceIcon } from './WorkspaceIcon'
import { useReducedMotion } from '../design-system/motion'

function NavigationItem({ label, icon, active, onPress }: { label: string; icon: 'content' | 'record' | 'folder' | 'processing' | 'account' | 'plug'; active: boolean; onPress: () => void }) {
  const reduced = useReducedMotion(), selection = useRef(new Animated.Value(active ? 1 : 0)).current
  useEffect(() => {
    if (reduced) { selection.setValue(active ? 1 : 0); return }
    const animation = Animated.timing(selection, { toValue: active ? 1 : 0, duration: 180, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true })
    animation.start(); return () => animation.stop()
  }, [active, reduced, selection])
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: 56, gap: 3, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
    <Animated.View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 26, transform: [{ scale: selection.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }] }}><WorkspaceIcon name={icon} color={active ? colors.navigationAccent : colors.muted} /></Animated.View>
    <Text style={{ fontSize: 12, lineHeight: 18, color: active ? colors.navigationAccent : colors.muted, fontWeight: active ? '500' : '400' }}>{label}</Text>
  </Pressable>
}
export function WorkspaceNavigation({
  selected,
  onNavigate,
}: {
  selected: 'meetings' | 'notes' | 'files' | 'connections'
  onNavigate: (destination: 'meetings' | 'notes' | 'files' | 'connections') => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
        marginTop: 4,
        paddingHorizontal: 12,
        paddingTop: 5,
        paddingBottom: 3,
      }}
    >
      {(
        [
          { label: '会议', icon: 'record', destination: 'meetings' },
          { label: '笔记', icon: 'content', destination: 'notes' },
          { label: '文件库', icon: 'folder', destination: 'files' },
          { label: '插件', icon: 'plug', destination: 'connections' },
        ] as const
      ).map(item => (
        <NavigationItem key={item.label} label={item.label} icon={item.icon} active={selected === item.destination} onPress={() => onNavigate(item.destination)} />
      ))}
    </View>
  )
}
