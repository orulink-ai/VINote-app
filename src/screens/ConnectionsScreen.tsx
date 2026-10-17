import React, { useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { styles } from '../design-system/theme'
import { ConnectorPluginStore } from '../components/ConnectorPluginStore'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'

export function ConnectionsScreen({ onBack, onFeishu, onMcp }: { onBack?: () => void; onFeishu: () => void; onMcp: () => void; onContentPlugin?: (id: 'translation' | 'diagram') => void }) {
  const epoch = useSyncExternalStore(subscribeIdentity, identityEpoch)
  return <View style={styles.screen}><ScreenHeader title="插件" onBack={onBack} backLabel="返回设置" /><ConnectorPluginStore key={epoch} epoch={epoch} onFeishu={onFeishu} onMcp={onMcp} /></View>
}
