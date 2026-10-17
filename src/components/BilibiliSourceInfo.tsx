import React from 'react'
import { View } from 'react-native'
import { Text } from './AppText'
import { styles } from '../design-system/theme'
import type { BilibiliSource } from '../types/bilibili'

export function BilibiliSourceInfo({ source }: { source?: BilibiliSource }) {
  if (!source) return null
  return <View style={{ gap: 6 }}>
    <Text style={styles.noteTitle}>B站来源</Text>
    <Text selectable style={styles.subtitle}>{source.bvid} · 第 {source.page} P</Text>
    <Text selectable numberOfLines={4} style={styles.subtitle}>{source.originalUrl}</Text>
  </View>
}
