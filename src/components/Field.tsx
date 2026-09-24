import React from 'react'

import { styles } from '../design-system/theme'
import { Input, Text, YStack } from 'tamagui'

export function Field({ label, editable, ...props }: { label: string; editable?: boolean } & React.ComponentProps<typeof Input>) {
  return <YStack><Text style={styles.label}>{label}</Text><Input {...props} disabled={editable === false} accessibilityLabel={label} style={styles.input} autoCapitalize="none" /></YStack>
}
