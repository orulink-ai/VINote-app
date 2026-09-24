import React, { useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, ScrollView } from 'react-native'
import { Button, Card, Text, XStack } from 'tamagui'
import { CloudModelPicker } from '../components/CloudModelPicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { Field } from '../components/Field'
import { colors, styles } from '../design-system/theme'
import { listenRecording, startRecording, stopRecording } from '../features/recording/recordingService'
import { LocalRecording, saveRecording, createRecordingDraft, finalizeRecording } from '../features/recording/recordingLibrary'
import { generateRecording } from '../features/recording/generateRecording'
import { recordingElapsedSeconds } from '../features/recording/recordingTimer'
export function RecordScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [mode, setMode] = useState<'audio' | 'minutes'>('audio')
  const [title, setTitle] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [modelsReady, setModelsReady] = useState(false)
  const [phase, setPhase] = useState('')
  const [pending, setPending] = useState<LocalRecording | null>(null)
  const lock = useRef(false)
  const draft = useRef<LocalRecording | null>(null)
  const recordingStartedAt = useRef<number | null>(null)
  useEffect(() => {
    if (!recording) return
    const updateElapsed = () => {
      if (recordingStartedAt.current === null) return
      setSeconds(previous => recordingElapsedSeconds(recordingStartedAt.current!, Date.now(), previous))
    }
    // The recorder callback can report a negative position on iOS. It only
    // triggers a refresh; the displayed duration comes from our own clock.
    const stopListening = listenRecording(updateElapsed)
    const timer = setInterval(updateElapsed, 1000)
    updateElapsed()
    return () => { stopListening(); clearInterval(timer) }
  }, [recording])
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (recording || busy || pending) Alert.alert('当前录音尚未完成', '请先结束并保存录音。处理失败后可在录音库重试。')
      else onBack()
      return true
    })
    return () => handler.remove()
  }, [recording, busy, pending, onBack])
  const start = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setPhase('正在准备麦克风…')
    try {
      draft.current = await createRecordingDraft(title)
      await startRecording(draft.current.uri)
      recordingStartedAt.current = Date.now()
      setSeconds(0); setRecording(true)
    }
    catch (e) {
      recordingStartedAt.current = null
      if (draft.current) await saveRecording({ ...draft.current, state: 'interrupted', error: '录音未能开始，请检查麦克风权限后新建录音' }).catch(() => {})
      Alert.alert('无法录音', e instanceof Error ? e.message : '请检查麦克风权限')
    }
    finally { lock.current = false; setBusy(false) }
  }
  const finish = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setPhase('正在保存原始录音…')
    let saved: LocalRecording | null = null
    try {
      const elapsed = recordingStartedAt.current === null ? seconds
        : recordingElapsedSeconds(recordingStartedAt.current, Date.now(), seconds)
      if (!pending) {
        if (!draft.current) throw new Error('未找到录音草稿')
        try { await stopRecording() } catch {
          // 停止返回值可能丢失；使用开始时已持久化的路径尝试找回文件。
          const interrupted = { ...draft.current, duration: elapsed, state: 'interrupted' as const, error: '录音异常结束，请播放检查后再生成纪要' }
          await saveRecording(interrupted)
          recordingStartedAt.current = null
          setRecording(false); setPending(null)
          Alert.alert('录音中断', '已保留录音记录和可用文件，请到录音库检查。', [{ text: '前往录音库', onPress: onDone }])
          return
        }
      }
      setRecording(false)
      recordingStartedAt.current = null
      const record = pending || { ...draft.current!, duration: elapsed,
        title: title.trim() || draft.current!.title, titleSource: title.trim() ? 'manual' as const : draft.current!.titleSource }
      setPending(record)
      saved = await finalizeRecording(record)
      setPending(null)
      if (mode === 'minutes') await generateRecording(saved, setPhase)
      onDone()
    } catch (e) {
      Alert.alert(saved ? '录音已保存，纪要处理失败' : '保存未完成', e instanceof Error ? e.message : '请重试', saved ? [{ text: '前往录音库', onPress: onDone }] : [
        { text: '重试保存', style: 'cancel' },
        { text: '保留文件并查看录音库', onPress: onDone },
      ])
    } finally { lock.current = false; setBusy(false) }
  }
  const stop = () => Alert.alert('结束录音？', mode === 'audio' ? '保存原始音频到本机，不进行云端转写。' : '先保存原始音频，再上传云端生成纪要。', [{ text: '继续录音', style: 'cancel' }, { text: '结束并保存', onPress: finish }])
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text color={colors.muted} fontSize={12} letterSpacing={2}>CAPTURE / 会议录音</Text>
    <Text style={styles.title}>新录音</Text>
    <Field label="录音名称" placeholder="例如：产品周会（可选）" value={title} onChangeText={setTitle} editable={!busy && !pending} maxLength={120} />
    <XStack gap="$2">{(['audio', 'minutes'] as const).map(value => <Button key={value} flex={1} disabled={recording || busy || !!pending} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} backgroundColor={mode === value ? colors.primarySoft : colors.card} color={mode === value ? colors.primary : colors.muted} borderColor={mode === value ? colors.primary : colors.line} borderWidth={1} onPress={() => setMode(value)}>{value === 'audio' ? '仅保存录音' : '生成会议纪要'}</Button>)}</XStack>
    <Text style={styles.subtitle}>{mode === 'audio' ? '音频保存在本机，随时播放、导出或补充生成纪要。' : '录音结束后上传完整音频，由云端转写并生成纪要。'}</Text>
    <Card borderWidth={1} padding="$5" backgroundColor={colors.card} borderColor={colors.line} borderRadius="$3" alignItems="center" gap="$3"><Text fontSize={48} color={recording ? colors.danger : colors.ink}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text><Text color={colors.muted}>{busy ? phase : recording ? '● 正在录音' : pending ? '等待保存，可重试' : '待开始'}</Text></Card>
    <PrimaryButton title={busy ? phase : recording ? '结束录音' : pending ? '重试保存录音' : '开始录音'} loading={busy} disabled={busy || (mode === 'minutes' && !modelsReady && !recording && !pending)} onPress={recording ? stop : pending ? finish : start} />
    {mode === 'minutes' && <CloudModelPicker disabled={recording || busy || !!pending} onReady={setModelsReady} />}
    <Text style={styles.subtitle}>录音支持切换其他 App 和锁屏。生成纪要会逐段保存进度；切回 App 后可继续。iOS 后台处理时长受系统限制。</Text>
    <PrimaryButton secondary title="返回首页" disabled={recording || busy || !!pending} onPress={onBack} />
  </ScrollView>
}
