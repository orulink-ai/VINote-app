import React from 'react'
import { Text, View } from 'react-native'
import { PrimaryButton } from '../components/PrimaryButton'
import { styles } from '../design-system/theme'

export function HomeScreen({ onRecord, onNotes, onSignOut }: { onRecord: () => void; onNotes: () => void; onSignOut: () => void }) {
  return <View style={styles.screen}><View style={styles.content}><Text style={styles.title}>今天记录什么？</Text><Text style={styles.subtitle}>录完会议后，VINote 会在云端完成转写、说话人整理和会议纪要生成。</Text><PrimaryButton title="开始录音" onPress={onRecord} /><PrimaryButton secondary title="查看会议纪要" onPress={onNotes} /><PrimaryButton secondary title="退出登录" onPress={onSignOut} /></View></View>
}
