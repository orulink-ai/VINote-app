import { Text } from './AppText'
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, type PressableProps } from 'react-native'
import { colors, styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'
import { LoadingDots } from './LoadingDots'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function PrimaryButton({ title, loading, secondary, tertiary, disabled, style, ...props }: { title: string; loading?: boolean; secondary?: boolean; tertiary?: boolean } & PressableProps) {
  const unavailable = !!disabled || !!loading
  const reduced = useReducedMotion(), scale = useRef(new Animated.Value(1)).current
  const [pressed, setPressed] = useState(false)
  useEffect(() => () => scale.stopAnimation(), [scale])
  // Uiverse 0x-Sarthak/hungry-penguin-30: active scale(.95), adapted to native touch.
  const press = (value: number) => { scale.stopAnimation(); if (reduced) { scale.setValue(1); return }; Animated.timing(scale, { toValue: value, duration: value === 1 ? 200 : 110, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start() }
  return <AnimatedPressable {...props} disabled={unavailable} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel || title}
    onPressIn={event => { setPressed(true); press(0.95); props.onPressIn?.(event) }} onPressOut={event => { setPressed(false); press(1); props.onPressOut?.(event) }}
    accessibilityState={{ disabled: unavailable, busy: !!loading }}
    style={[tertiary ? styles.textButton : secondary ? styles.secondaryButton : styles.button, { flexDirection: 'row', gap: 9, transform: [{ scale }] }, unavailable && { opacity: loading ? 0.8 : 0.42 }, pressed && { opacity: 0.82 }, typeof style === 'function' ? style({ pressed }) : style]}>
    {loading && <LoadingDots color={secondary || tertiary ? colors.primary : colors.onPrimary} />}
    <Text style={tertiary ? styles.textButtonText : secondary ? styles.secondaryButtonText : styles.buttonText}>{title}</Text>
  </AnimatedPressable>
}
