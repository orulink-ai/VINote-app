import React from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'
import { styles } from '../design-system/theme'

export function Field({ label, editable, ...props }: { label: string } & TextInputProps) {
  return <View><Text style={styles.label}>{label}</Text><TextInput {...props} editable={editable !== false} accessibilityLabel={label} placeholderTextColor="#A1A1AA" style={styles.input} autoCapitalize="none" /></View>
}
