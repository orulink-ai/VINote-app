import React, { useState } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'
import { styles } from '../design-system/theme'

export function Field({ label, editable, onFocus, onBlur, ...props }: { label: string } & TextInputProps) {
  const [focused, setFocused] = useState(false)
  return <View><Text style={styles.label}>{label}</Text><TextInput {...props} editable={editable !== false} accessibilityLabel={label} placeholderTextColor="#A1A1AA" style={[styles.input, focused && styles.inputFocused]} autoCapitalize="none"
    onFocus={event => { setFocused(true); onFocus?.(event) }} onBlur={event => { setFocused(false); onBlur?.(event) }} /></View>
}
