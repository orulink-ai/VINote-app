import React from 'react'
import { ActivityIndicator } from 'react-native'
import { colors, styles } from '../design-system/theme'
import { Button, Text } from 'tamagui'

export function PrimaryButton({ title, loading, secondary, ...props }: { title: string; loading?: boolean; secondary?: boolean } & React.ComponentProps<typeof Button>) {
  return <Button {...props} disabled={props.disabled || loading} accessibilityLabel={title} opacity={props.disabled ? 0.45 : 1} height={52} borderRadius="$3" backgroundColor={secondary ? colors.primarySoft : colors.primary} borderWidth={0} pressStyle={{ opacity: 0.75 }}>{loading ? <ActivityIndicator color={secondary ? colors.primary : '#FFF'} /> : <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{title}</Text>}</Button>
}
