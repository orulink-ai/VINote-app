import React from 'react'
import { View } from 'react-native'
import { colors } from '../design-system/theme'

export function BrandMark({ size = 48 }: { size?: number }) {
  const scale = size / 48
  return <View accessibilityLabel="VINote" style={{ width: size, height: size, borderRadius: 14 * scale, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 22 * scale, height: 26 * scale, borderRadius: 4 * scale, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 2 * scale }}>
      {[7, 12, 17, 10].map((height, index) => <View key={index} style={{ width: 2.5 * scale, height: height * scale, borderRadius: 2 * scale, backgroundColor: colors.ink }} />)}
    </View>
  </View>
}
