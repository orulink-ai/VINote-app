import React from 'react'
import { Text, TextInput, View } from 'react-native'
import { styles } from '../design-system/theme'

export function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <View><Text style={styles.label}>{label}</Text><TextInput {...props} style={styles.input} autoCapitalize="none" /></View>
}
