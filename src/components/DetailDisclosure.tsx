import React, { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from './AppText'
import { styles } from '../design-system/theme'

export function DetailDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={styles.label}>{title}</Text><Text style={styles.subtitle}>{expanded ? '收起 −' : '展开 +'}</Text>
    </Pressable>
    {expanded && <View style={{ gap: 12 }}>{children}</View>}
  </View>
}
