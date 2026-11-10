import React, { useEffect, useRef, useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import { PrimaryButton } from './PrimaryButton'
import { Text } from './AppText'
import { styles } from '../design-system/theme'
import { checkAndroidRelease, type AndroidRelease } from '../lib/androidRelease'
import { checkInstallableAndroidRelease, type InstallableAndroidRelease } from '../lib/installableAndroidRelease'
import { downloadApkUpdate } from '../lib/downloadApkUpdate'
import { hasOfficialUpdateInstaller, installApkUpdate, openApkInstallSettings } from '../lib/installApkUpdate'

const appVersion: string = require('../../package.json').version

/** A download is verified before the OS installer is shown; installation remains user-controlled. */
export function AndroidUpdateInstall() {
  const [release, setRelease] = useState<AndroidRelease | null>(null)
  const [installable, setInstallable] = useState<InstallableAndroidRelease | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [permission, setPermission] = useState(false)
  const active = useRef<ReturnType<typeof downloadApkUpdate> | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const officialInstaller = hasOfficialUpdateInstaller()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.cancel() } }, [])
  if (Platform.OS !== 'android') return null
  const check = async () => {
    if (locked.current) return
    locked.current = true
    setBusy(true); setMessage(''); setPath(''); setPermission(false); setRelease(null); setInstallable(null)
    try {
      const found = await checkAndroidRelease(appVersion)
      const candidate = found ? await checkInstallableAndroidRelease(appVersion) : null
      if (!mounted.current) return
      const verifiedCandidate = officialInstaller && candidate && candidate.version === found?.version && candidate.apkUrl === found.apkUrl ? candidate : null
      setRelease(found); setInstallable(verifiedCandidate)
      setMessage(!found ? '暂无可用的正式更新。' : !officialInstaller ? '当前安装包不支持正式版应用内更新，可打开发布页面查看。' : !verifiedCandidate ? '更新包暂不能在应用内校验，可打开发布页面查看。' : '')
    } catch { if (mounted.current) setMessage('检查更新失败，请检查网络后重试。') }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  const download = async () => {
    if (!installable || locked.current) return
    locked.current = true
    setBusy(true); setMessage(''); setProgress(0); setPermission(false)
    try {
      const downloadTask = downloadApkUpdate(installable.asset, (written, total) => { if (mounted.current) setProgress(Math.floor(written * 100 / total)) })
      active.current = downloadTask
      const verified = await downloadTask.promise
      if (mounted.current) { setPath(verified); setMessage('下载和文件校验完成，可以安装。') }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '下载失败，请重试。') }
    finally { active.current = null; locked.current = false; if (mounted.current) { setBusy(false); setProgress(null) } }
  }
  const install = async () => {
    if (!path || locked.current) return
    locked.current = true
    setBusy(true); setMessage('')
    try {
      const outcome = await installApkUpdate(path)
      if (!mounted.current) return
      setPermission(outcome === 'permission_required')
      setMessage(outcome === 'permission_required' ? '请先允许 VINote 安装应用，然后返回此处继续。' : '已打开系统安装器，请在手机上确认安装。')
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '无法打开系统安装器。') }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  return <View style={[styles.card, { gap: 10 }]}>
    <Text accessibilityRole="header" style={styles.noteTitle}>应用更新</Text>
    <Text style={styles.subtitle}>当前版本 {appVersion} · 正式版来自 VINote 公开仓库</Text>
    {release && <><Text style={styles.noteBody}>发现新版本 {release.version}</Text>{!!release.notes && <Text style={styles.subtitle}>{release.notes}</Text>}</>}
    {progress !== null && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>正在下载 {progress}%</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{message}</Text>}
    {busy && progress !== null && <PrimaryButton secondary title="取消下载" onPress={() => active.current?.cancel()} />}
    {!busy && permission && <PrimaryButton secondary title="打开安装权限设置" onPress={() => void openApkInstallSettings().catch(() => setMessage('无法打开安装权限设置，请在系统设置中操作。'))} />}
    {!busy && !!path && <PrimaryButton title="安装更新" onPress={() => void install()} />}
    {!busy && !path && !!installable && <PrimaryButton title="下载更新" onPress={() => void download()} />}
    {!!release && <PrimaryButton secondary title="查看发布页面" onPress={() => void Linking.openURL(release.pageUrl).catch(() => setMessage('无法打开发布页面。'))} />}
    <PrimaryButton secondary title="检查更新" loading={busy && progress === null} disabled={busy} onPress={() => void check()} />
  </View>
}
