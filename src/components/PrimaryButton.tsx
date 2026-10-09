import React from 'react'
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native'
import { colors, styles } from '../design-system/theme'

export function PrimaryButton({ title, loading, secondary, disabled, style, ...props }: { title: string; loading?: boolean; secondary?: boolean } & PressableProps) {
  const unavailable = !!disabled || !!loading
  return <Pressable {...props} disabled={unavailable} accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled: unavailable, busy: !!loading }}
    style={({ pressed }) => [secondary ? styles.secondaryButton : styles.button, unavailable && { opacity: 0.45 }, pressed && { opacity: 0.72 }, typeof style === 'function' ? style({ pressed }) : style]}>
    {loading ? <ActivityIndicator color={secondary ? colors.primary : '#FFF'} /> : <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{title}</Text>}
  </Pressable>
}
