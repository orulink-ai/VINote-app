import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, LayoutAnimation, Platform, Pressable, UIManager, View } from 'react-native'
import { Text } from './AppText'
import { styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'

export function DetailDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotion(), rotation = useRef(new Animated.Value(0)).current
  useEffect(() => { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true) }, [])
  const toggle = () => {
    if (!reduced) LayoutAnimation.configureNext({ duration: 200, update: { type: LayoutAnimation.Types.easeInEaseOut }, create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity }, delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity } })
    Animated.timing(rotation, { toValue: expanded ? 0 : 1, duration: reduced ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    setExpanded(value => !value)
  }
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
      onPress={toggle} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={[styles.label, { marginBottom: 0 }]}>{title}</Text><Animated.Text accessible={false} style={[styles.subtitle, { fontSize: 20, transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }]}>›</Animated.Text>
    </Pressable>
    {expanded && <View style={{ gap: 12 }}>{children}</View>}
  </View>
}
