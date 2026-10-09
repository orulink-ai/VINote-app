import React from 'react'
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native'
import { colors, styles } from '../design-system/theme'

export function PrimaryButton({ title, loading, secondary, tertiary, disabled, style, ...props }: { title: string; loading?: boolean; secondary?: boolean; tertiary?: boolean } & PressableProps) {
  const unavailable = !!disabled || !!loading
  return <Pressable {...props} disabled={unavailable} accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled: unavailable, busy: !!loading }}
    style={({ pressed }) => [tertiary ? styles.textButton : secondary ? styles.secondaryButton : styles.button, unavailable && { opacity: 0.45 }, pressed && { opacity: 0.72 }, typeof style === 'function' ? style({ pressed }) : style]}>
    {loading ? <ActivityIndicator color={secondary || tertiary ? colors.primary : '#FFF'} /> : <Text style={tertiary ? styles.textButtonText : secondary ? styles.secondaryButtonText : styles.buttonText}>{title}</Text>}
  </Pressable>
}
