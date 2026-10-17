import { DetailDisclosure } from '../components/DetailDisclosure'
import { Text } from '../components/AppText'
import React, { useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, ScrollView, View } from 'react-native'
import { ScreenHeader } from '../components/ScreenHeader'
import { PrimaryButton } from '../components/PrimaryButton'
import { Field } from '../components/Field'
import { colors, styles } from '../design-system/theme'
import {
  listenRecording,
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  isRecordingActive,
} from '../features/recording/recordingService'
import {
  LocalRecording,
  saveRecording,
  createRecordingDraft,
  finalizeRecording,
} from '../features/recording/recordingLibrary'
import { recordingElapsedSeconds } from '../features/recording/recordingTimer'
export type RecordingPhase = 'idle' | 'preparing' | 'cancelling' | 'recording' | 'unconfirmed' | 'paused' | 'pausing' | 'resuming' | 'saving' | 'save-failed'
export type RecordingCaptureState = { active: boolean; paused: boolean; seconds: number; unsaved: boolean; status?: RecordingPhase }
export function RecordScreen({
  onDone,
  onBack,
  visible = true,
  onState,
}: {
  onDone: (recordingId?: string) => void
  onBack: () => void
  visible?: boolean
  onState?: (state: RecordingCaptureState) => void
}) {
  const [title, setTitle] = useState('')
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [marks, setMarks] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [phase, setPhase] = useState('')
  const [operation, setOperation] = useState<RecordingPhase | null>(null)
  const [captureMessage, setCaptureMessage] = useState('')
  const [captureUnconfirmed, setCaptureUnconfirmed] = useState(false)
  const [pending, setPending] = useState<LocalRecording | null>(null)
  const pendingRecord = useRef<LocalRecording | null>(null)
  const preparation = useRef<AbortController | null>(null)
  const retainPending = (value: LocalRecording | null) => { pendingRecord.current = value; setPending(value) }
  const lock = useRef(false)
  const draft = useRef<LocalRecording | null>(null)
  const recordingStartedAt = useRef<number | null>(null)
  const accumulatedMs = useRef(0)
  const elapsedNow = () => Math.floor((accumulatedMs.current + (recordingStartedAt.current === null ? 0 : Math.max(0, Date.now() - recordingStartedAt.current))) / 1000)
  const status = operation || (pending ? 'save-failed' : recording ? captureUnconfirmed ? 'unconfirmed' : paused ? 'paused' : 'recording' : 'idle')
  useEffect(() => { onState?.({ active: recording, paused, seconds, unsaved: !!pending || busy, status }) }, [recording, paused, seconds, pending, busy, status, onState])
  useEffect(() => () => preparation.current?.abort(), [])
  useEffect(() => {
    if (!recording) return
    const updateElapsed = () => {
      if (recordingStartedAt.current === null) return
      setSeconds(previous =>
        recordingElapsedSeconds(
          recordingStartedAt.current! - accumulatedMs.current,
          Date.now(),
          previous,
        ),
      )
    }
    // The recorder callback can report a negative position on iOS. It only
    // triggers a refresh; the displayed duration comes from our own clock.
    const stopListening = listenRecording(updateElapsed)
    const timer = setInterval(updateElapsed, 1000)
    updateElapsed()
    return () => {
      stopListening()
      clearInterval(timer)
    }
  }, [recording, paused])
  useEffect(() => {
    if (!visible) return
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy || pending)
        Alert.alert(
          '当前录音尚未完成',
          '请先结束并保存录音。处理失败后可在录音库重试。',
        )
      else onBack()
      return true
    })
    return () => handler.remove()
  }, [recording, busy, pending, onBack, visible])
  const start = async () => {
    if (lock.current) return
    lock.current = true
    const attempt = new AbortController()
    preparation.current = attempt
    setBusy(true)
    setOperation('preparing')
    setCaptureMessage('')
    setCaptureUnconfirmed(false)
    setPhase('正在准备麦克风…')
    try {
      draft.current = await createRecordingDraft(title)
      await startRecording(draft.current.uri, attempt.signal)
      recordingStartedAt.current = Date.now()
      accumulatedMs.current = 0
      setMarks([])
      setPaused(false)
      setSeconds(0)
      setRecording(true)
    } catch (e) {
      recordingStartedAt.current = null
      if (e instanceof Error && e.name === 'RecordingReleaseError') {
        setCaptureUnconfirmed(true)
        setRecording(true)
        Alert.alert('取消准备未完成', e.message)
        return
      }
      if (draft.current)
        await saveRecording({
          ...draft.current,
          state: 'interrupted',
          error: attempt.signal.aborted ? '录音准备已取消，未完成录制' : '录音未能开始，请检查麦克风权限后重新开始',
        }).catch(() => {})
      if (attempt.signal.aborted) setCaptureMessage('准备已取消，设备已释放。可以重新开始。')
      else Alert.alert(
        '无法录音',
        e instanceof Error ? e.message : '请检查麦克风权限',
      )
    } finally {
      lock.current = false
      setBusy(false)
      setOperation(null)
      if (preparation.current === attempt) preparation.current = null
    }
  }
  const cancelPreparation = () => {
    if (!preparation.current || preparation.current.signal.aborted) return
    preparation.current.abort()
    setOperation('cancelling')
    setPhase('正在取消准备，等待设备释放…')
  }
  const finish = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setOperation('saving')
    setPhase('正在保存录音…')
    try {
      const elapsed = elapsedNow()
      const recovery = pendingRecord.current
      if (!recovery) {
        if (!draft.current) throw new Error('未找到录音草稿')
        try {
          await stopRecording()
        } catch {
          if (isRecordingActive()) {
            setCaptureUnconfirmed(true)
            Alert.alert('结束录音未完成', '尚未确认麦克风已停止。录音控制和原记录已保留，请再次结束录音。')
            return
          }
          // 停止返回值可能丢失；使用开始时已持久化的路径尝试找回文件。
          const interrupted = {
            ...draft.current,
            duration: elapsed,
            state: 'interrupted' as const,
            error: '录音异常结束，请播放检查后再生成纪要',
          }
          retainPending(interrupted)
          recordingStartedAt.current = null
          setRecording(false)
          await saveRecording(interrupted)
          retainPending(null)
          Alert.alert(
            '录音中断',
            '已保留录音记录和可用文件，请到录音库检查。',
            [{ text: '前往录音库', onPress: () => onDone() }],
          )
          return
        }
      }
      setRecording(false)
      setCaptureUnconfirmed(false)
      recordingStartedAt.current = null
      const record = recovery || {
        ...draft.current!,
        duration: elapsed,
        bookmarks: marks.map(seconds => ({ seconds, label: '会议标记' })),
        title: title.trim() || draft.current!.title,
        titleSource: title.trim()
          ? ('manual' as const)
          : draft.current!.titleSource,
      }
      retainPending(record)
      const saved = await finalizeRecording(record)
      retainPending(null)
      Alert.alert(
        '录音已保存',
        '现在生成会议纪要，或稍后处理。',
        [
          { text: '仅保存录音', onPress: () => onDone() },
          { text: '生成会议纪要', onPress: () => onDone(saved.id) },
        ],
      )
    } catch (e) {
      Alert.alert('原录音保存未完成', e instanceof Error ? e.message : '请重试', [
        { text: '重试保存原录音', onPress: () => void finish() },
        { text: '保留文件并查看录音库', onPress: onDone },
      ])
    } finally {
      lock.current = false
      setBusy(false)
      setOperation(null)
    }
  }
  const stop = () =>
    Alert.alert('结束录音？', '结束后保存录音。', [
      { text: paused || captureUnconfirmed ? '暂不结束' : '继续录音', style: 'cancel' },
      { text: '结束并保存', onPress: finish },
    ])
  const togglePause = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setOperation(paused ? 'resuming' : 'pausing')
    setPhase(paused ? '正在继续录音…' : '正在暂停…')
    try {
      if (paused) {
        await resumeRecording()
        recordingStartedAt.current = Date.now()
        setPaused(false)
      } else {
        await pauseRecording()
        if (recordingStartedAt.current !== null) accumulatedMs.current += Math.max(0, Date.now() - recordingStartedAt.current)
        recordingStartedAt.current = null
        setSeconds(elapsedNow())
        setPaused(true)
      }
    } catch (cause) { Alert.alert('操作未完成', cause instanceof Error ? cause.message : '请重试') }
    finally { lock.current = false; setBusy(false); setOperation(null) }
  }
  return (
    <View style={[styles.screen, { backgroundColor: colors.card }]}>
      <ScreenHeader title={recording ? captureUnconfirmed ? '检查录音状态' : paused ? '录音已暂停' : '正在录音' : pending ? '保存录音' : '新录音'} onBack={onBack} disabled={busy || !!pending} backLabel={recording ? captureUnconfirmed ? '返回会议，保留录音控制' : paused ? '返回会议，录音保持暂停' : '返回会议，录音继续' : '返回会议'} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { flexGrow: 1 }]}
      >
        <Field
          label="录音名称"
          placeholder="例如：产品周会（可选）"
          value={title}
          onChangeText={setTitle}
          editable={!busy && !pending}
          maxLength={120}
        />
        <View
          style={{
            flex: 1,
            minHeight: 230,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 32,
            gap: 20,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: recording
                ? colors.dangerSoft
                : colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: recording ? 3 : 7,
                backgroundColor: recording ? colors.danger : colors.ink,
              }}
            />
          </View>
          <Text style={styles.timer}>
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:
            {String(seconds % 60).padStart(2, '0')}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.subtitle,
              { color: recording ? colors.danger : colors.muted },
            ]}
          >
            {busy
              ? phase
              : recording
              ? captureUnconfirmed ? '录音状态待确认，请结束并保存或检查设备' : paused ? '已暂停 · 继续后接着录制' : '正在录音'
              : pending
              ? '等待保存，可重试'
              : captureMessage || '准备好后点击开始'}
          </Text>
        </View>
        <DetailDisclosure title="录音说明"><Text style={styles.subtitle}>录音时可以切换 App 或锁屏。暂停时间不计入录音时长。</Text><Text style={styles.subtitle}>录音保存后，可选择模型生成会议纪要。</Text></DetailDisclosure>
        {!!marks.length && <Text style={styles.subtitle}>已标记：{marks.map(second => `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}`).join(' · ')}</Text>}
      </ScrollView>
      <View
        style={{
          gap: 10,
          borderTopWidth: 1,
          borderColor: colors.line,
          padding: 20,
        }}
      >
        {recording && !captureUnconfirmed && <View style={{ flexDirection: 'row', gap: 10 }}><PrimaryButton secondary style={{ flex: 1 }} title={paused ? '继续录音' : '暂停'} disabled={busy} onPress={() => void togglePause()} /><PrimaryButton secondary style={{ flex: 1 }} title="标记" disabled={busy || paused} onPress={() => setMarks(current => [...new Set([...current, elapsedNow()])])} /></View>}
        <PrimaryButton
          title={
            busy
              ? phase
              : recording
              ? '结束录音'
              : pending
              ? '重试保存录音'
              : '开始录音'
          }
          loading={busy}
          disabled={busy}
          onPress={recording ? stop : pending ? finish : start}
        />
        {operation === 'preparing' && <PrimaryButton secondary title="取消准备" onPress={cancelPreparation} />}
        <PrimaryButton
          tertiary
          title={recording ? '收起录音，返回工作台' : '返回工作台'}
          disabled={busy || !!pending}
          onPress={onBack}
        />
      </View>
    </View>
  )
}
