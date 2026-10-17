import { Text } from './AppText'
import React from 'react'
import { Pressable, View } from 'react-native'
import { colors, styles } from '../design-system/theme'

export function SettingsCheckbox({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void
}) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label}
    accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled}
    onPress={() => onChange(!checked)}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
    <View style={{ width: 16, height: 16, borderWidth: 1, borderColor: checked ? colors.ink : colors.line, borderRadius: 3, backgroundColor: checked ? colors.ink : colors.card, alignItems: 'center', justifyContent: 'center' }}>
      {checked && <Text style={{ color: colors.onPrimary, fontSize: 12, lineHeight: 14 }}>✓</Text>}
    </View>
    <Text style={styles.noteBody}>{label}</Text>
  </Pressable>
}
