import React from 'react'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import { colors, styles } from '../design-system/theme'

export function PrimaryButton({ title, loading, secondary, ...props }: { title: string; loading?: boolean; secondary?: boolean } & React.ComponentProps<typeof Pressable>) {
  return <Pressable {...props} style={secondary ? styles.secondaryButton : styles.button}>{loading ? <ActivityIndicator color={secondary ? colors.primary : '#FFF'} /> : <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{title}</Text>}</Pressable>
}
