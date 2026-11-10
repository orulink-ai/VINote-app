import React, { useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import { PrimaryButton } from './PrimaryButton'
import { Text } from './AppText'
import { styles } from '../design-system/theme'
import { checkAndroidRelease, type AndroidRelease } from '../lib/androidRelease'

const appVersion: string = require('../../package.json').version

export function AndroidUpdateCheck() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [release, setRelease] = useState<AndroidRelease | null>(null)
  if (Platform.OS !== 'android') return null
  const check = async () => {
    if (busy) return
    setBusy(true); setMessage(''); setRelease(null)
    try {
      const result = await checkAndroidRelease(appVersion)
      setRelease(result)
      if (!result) setMessage('暂无可用的正式更新。')
    } catch { setMessage('检查更新失败，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  return <View style={[styles.card, { gap: 10 }]}>
    <Text accessibilityRole="header" style={styles.noteTitle}>应用更新</Text>
    <Text style={styles.subtitle}>当前版本 {appVersion} · 从 VINote 公开仓库获取正式版</Text>
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{message}</Text>}
    {release && <><Text style={styles.noteBody}>发现新版本 {release.version}</Text>
      {!!release.notes && <Text style={styles.subtitle}>{release.notes}</Text>}
      <PrimaryButton secondary title="查看版本与下载" onPress={() => void Linking.openURL(release.pageUrl).catch(() => setMessage('无法打开下载页面，请稍后重试。'))} />
    </>}
    <PrimaryButton secondary title="检查更新" loading={busy} onPress={() => void check()} />
  </View>
}
