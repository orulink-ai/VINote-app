import React, { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { LoadingDots } from './LoadingDots'
import { useReducedMotion } from '../design-system/motion'

export function AsyncState({ loading, error, empty, onRetry, loadingLabel = '正在处理，请稍候', retryLabel = '重试' }: { loading?: boolean; error?: string; empty?: string; onRetry?: () => void; loadingLabel?: string; retryLabel?: string }) {
  if (!loading && !error && !empty) return null
  return <View style={[styles.card, { gap: 10, padding: 12, backgroundColor: error ? colors.dangerSoft : colors.card }]} accessibilityLiveRegion="polite">
    {loading && <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }}><LoadingDots /></View><Text style={[styles.subtitle, { flex: 1 }]}>{loadingLabel}</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    {!loading && !!error && onRetry && <PrimaryButton secondary style={{ alignSelf: 'flex-start', minHeight: 44 }} title={retryLabel} onPress={onRetry} />}
    {!loading && !error && !!empty && <Text style={styles.subtitle}>{empty}</Text>}
  </View>
}

export function GentleEntrance({ children, transitionKey }: { children: React.ReactNode; transitionKey?: string }) {
  const opacity = useRef(new Animated.Value(1)).current
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) { opacity.setValue(1); return }
    opacity.setValue(0)
    const animation = Animated.timing(opacity, { toValue: 1, duration: 180, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [opacity, reduced, transitionKey])
  return <Animated.View style={{ flex: 1, opacity, transform: [{ translateY: reduced ? 0 : opacity.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }}>{children}</Animated.View>
}
