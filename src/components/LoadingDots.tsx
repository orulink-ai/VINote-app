import React, { useEffect, useRef } from 'react'
import { Animated, AppState, View } from 'react-native'
import { colors } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'

export function LoadingDots({ color = colors.ink }: { color?: string }) {
  const reduced = useReducedMotion(), progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduced) { progress.setValue(0); return }
    // Bounded acknowledgement; never keep a native loop running in the background.
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 550, useNativeDriver: true }),
    ]), { iterations: 4 })
    const update = (state: string) => {
      animation.stop()
      progress.setValue(0)
      if (state === 'active') { animation.reset(); animation.start() }
    }
    update(AppState.currentState ?? 'inactive')
    const listener = AppState.addEventListener('change', update)
    return () => { listener.remove(); animation.stop() }
  }, [progress, reduced])
  return <View accessible={false} style={{ flexDirection: 'row', gap: 3, minWidth: 27, height: 20, alignItems: 'center' }}>
    {[0, 1, 2, 3, 4].map(index => <Animated.View key={index} style={{ width: 3, height: 15, borderRadius: 2, backgroundColor: color,
      opacity: reduced ? 0.75 : 0.85,
      transform: [{ scaleY: reduced ? 0.65 : progress.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0.4, 0.65, 1, 0.7, 0.45, 0.4].map((_, step, values) => values[(step + index) % values.length]) }) }] }} />)}
  </View>
}
