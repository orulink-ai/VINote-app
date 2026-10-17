import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from './AppText'
import { colors, styles } from '../design-system/theme'

/** Only completed, measured work earns a percentage. Unknown provider time stays indeterminate. */
export function ProcessingProgress({ label, percent, unknownLabel = '正在准备，尚无可计量进度' }: { label: string; percent?: number | null; unknownLabel?: string }) {
  const measured = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100
  const value = measured ? Math.floor(percent) : null
  return <View style={{ gap: 7 }} accessibilityLiveRegion="polite">
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text style={styles.subtitle}>{label}</Text>
      {value === null ? <ActivityIndicator size="small" color={colors.navigationAccent} /> : <Text style={styles.subtitle}>{value}%</Text>}
    </View>
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={value === null ? undefined : { min: 0, max: 100, now: value }} style={{ height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.line }}>
      {value !== null && <View style={{ width: `${value}%`, height: '100%', backgroundColor: colors.navigationAccent }} />}
    </View>
    {value === null && <Text style={styles.subtitle}>{unknownLabel}</Text>}
  </View>
}
