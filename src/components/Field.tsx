import { Text } from './AppText'
import React, { useState } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'
import { colors, styles } from '../design-system/theme'

export function Field({ label, hideLabel = false, accessibilityLabel, editable, onFocus, onBlur, style, ...props }: { label: string; hideLabel?: boolean } & TextInputProps) {
  const [focused, setFocused] = useState(false)
  return <View style={{ gap: 7 }}>{!hideLabel && <Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text>}<TextInput {...props} editable={editable !== false} accessibilityLabel={accessibilityLabel?.trim() || label} placeholderTextColor={colors.muted} style={[styles.input, focused && styles.inputFocused, editable === false && { opacity: 0.65 }, style]} autoCapitalize="none"
    onFocus={event => { setFocused(true); onFocus?.(event) }} onBlur={event => { setFocused(false); onBlur?.(event) }} /></View>
}
