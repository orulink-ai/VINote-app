import React, { useCallback } from 'react'
import { ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { CloudModelPicker } from '../components/CloudModelPicker'
import { Text } from '../components/AppText'
import { styles } from '../design-system/theme'

export function ModelSettingsScreen({ onBack }: { onBack: () => void }) {
  const ready = useCallback(() => {}, [])
  return <View style={styles.screen}>
    <ScreenHeader title="转写与总结" onBack={onBack} backLabel="返回我的" />
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text style={styles.subtitle}>选择下一次处理使用的服务。正在生成的内容继续使用启动时的模型。</Text>
      <View style={styles.card}><CloudModelPicker disabled={false} onReady={ready} /></View>
    </ScrollView>
  </View>
}
